// Runs a fuzz of one request (common/fuzz.ts says where payloads go and what
// the answers show). Every attempt goes the way Send does: the pre-request
// script, the render, the payload put in its position, the plugins, the send,
// then the assertions and the after-response script. The scripts are told
// what's being tried, as variables: fuzzPayload, fuzzPosition, fuzzAttempt
// (0 for the request as it is). Nothing sent is kept: no response in the
// history, no cookie in the jar.
import fs from 'node:fs';

import { fuzzAttempts, type FuzzExchange, type FuzzFlag, type FuzzPayload, type FuzzPoint, fuzzPoints, judgeAttempt, withPayload } from '../common/fuzz';
import { RENDER_PURPOSE_SEND } from '../common/render';
import { isRequest } from '../models/request';
import { getBoundedBodyBuffer } from '../models/response';
import { runPreRequestScript } from '../scripting/request-scripts';
import { cancelCurlAndWriteTimeline, fetchRequestData, sendCurlAndWriteTimeline, transformedResponse, transformUrl, tryToInterpolateRequest, tryToTransformRequestWithPlugins } from './network';

// as much of each answer as is looked through, and as much as is kept to show
const BODY_BYTES = 256 * 1024;
const SNIPPET_CHARS = 4000;
// the most attempts one run makes
export const FUZZ_MAX_ATTEMPTS = 2000;

export interface FuzzAttemptResult {
  // 1 for the first attempt
  index: number;
  pointId: string;
  position: string;
  payload: string;
  statusCode: number;
  bytes: number;
  elapsed: number;
  error?: string;
  flags: FuzzFlag[];
  // has a flag worth looking at on its own
  notable: boolean;
  // the start of the answer's body
  snippet: string;
}

export interface FuzzRunSummary {
  // the request as it is, sent first: what the attempts are compared with
  baseline: Pick<FuzzExchange, 'statusCode' | 'bytes' | 'elapsed' | 'error'>;
  attempts: FuzzAttemptResult[];
  notable: number;
  // requests sent, the first included
  requests: number;
  stopped: boolean;
}

export interface FuzzOptions {
  // in place of the workspace's active environment
  environmentId?: string | null;
  // the positions to put payloads in, by their ids
  pointIds: string[];
  payloads: FuzzPayload[];
  // milliseconds between attempts
  delay?: number;
  onAttempt?: (attempt: FuzzAttemptResult) => void;
  signal?: AbortSignal;
  // throws for a URL that mustn't be sent to
  checkUrl?: (url: string) => void;
}

const remove = (path?: string) => path ? fs.promises.rm(path, { force: true }).catch(() => undefined) : undefined;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const load = async (requestId: string, environmentId?: string | null) => {
  const { request, environment, settings, clientCertificates, caCert } = await fetchRequestData(requestId);
  if (!isRequest(request)) {
    throw new Error('Only an HTTP request can be fuzzed');
  }
  return { request, settings, clientCertificates, caCert, envId: environmentId === undefined ? environment._id : environmentId || '' };
};

// The places a request's values are, in the request as it would be sent now
export async function listFuzzPoints(requestId: string, environmentId?: string | null): Promise<{ points: FuzzPoint[]; method: string; url: string }> {
  const { request, envId } = await load(requestId, environmentId);
  const { request: rendered } = await tryToInterpolateRequest(request, envId, RENDER_PURPOSE_SEND);
  return { points: fuzzPoints(rendered), method: rendered.method, url: rendered.url };
}

export async function runFuzz(requestId: string, { environmentId, pointIds, payloads, delay = 0, onAttempt, signal, checkUrl }: FuzzOptions): Promise<FuzzRunSummary> {
  const { request, settings, clientCertificates, caCert, envId } = await load(requestId, environmentId);

  // one exchange: the request as it is, or with a payload in a position.
  // Null when the position isn't in the request this time round.
  const exchange = async (variables: Record<string, unknown>, change?: { pointId: string; payload: FuzzPayload }): Promise<FuzzExchange | null> => {
    const scripted = await runPreRequestScript(request, { environmentId: envId || null, iterationData: variables });
    const renderResult = await tryToInterpolateRequest(scripted.request, envId, RENDER_PURPOSE_SEND, undefined, { ...variables, ...scripted.variables });
    if (change) {
      const changed = withPayload(renderResult.request, change.pointId, change.payload);
      if (!changed) {
        return null;
      }
      renderResult.request = changed;
    }
    const rendered = await tryToTransformRequestWithPlugins(renderResult);
    // nothing kept from it
    rendered.settingStoreCookies = false;
    checkUrl?.(transformUrl(rendered.url, rendered.parameters, rendered.segmentParams, rendered.authentication, rendered.settingEncodeUrl).finalUrl);
    if (signal?.aborted) {
      throw new Error('Stopped');
    }
    const response = await sendCurlAndWriteTimeline(rendered, clientCertificates, caCert, settings);
    try {
      const failed = 'error' in response && response.error ? response.error : undefined;
      const answer = response as { statusCode?: number; bodyPath?: string; bodyCompression?: 'zip' | null; elapsedTime?: number; bytesRead?: number; bytesContent?: number };
      const body = !failed && answer.bodyPath ? (await getBoundedBodyBuffer(answer, BODY_BYTES)).buffer.toString('utf8') : '';
      // the assertions and the after-response script, as Send runs them: what
      // they fail is the script's way to say an attempt counts
      const checked = await transformedResponse(response, envId || null, rendered, renderResult.context, { preRequestLogs: scripted.logs, iterationData: variables });
      return {
        statusCode: answer.statusCode || 0,
        body,
        bytes: answer.bytesContent || answer.bytesRead || Buffer.byteLength(body),
        elapsed: answer.elapsedTime || 0,
        ...(failed ? { error: failed } : {}),
        failedChecks: (checked.assertionResults || []).filter(({ passed }) => !passed).map(({ message }) => message),
      };
    } finally {
      await remove(response.timelinePath);
      await remove('bodyPath' in response ? response.bodyPath : undefined);
    }
  };

  const stop = () => {
    cancelCurlAndWriteTimeline(request._id).catch(() => undefined);
  };
  signal?.addEventListener('abort', stop);
  try {
    const baseline = await exchange({ fuzzAttempt: 0, fuzzPayload: '', fuzzPosition: '' });
    if (!baseline) {
      throw new Error('The request could not be sent');
    }
    // the positions as the request has them now, the ones asked for
    const { request: rendered } = await tryToInterpolateRequest(request, envId, RENDER_PURPOSE_SEND);
    const points = fuzzPoints(rendered).filter(({ id }) => pointIds.includes(id));
    const planned = fuzzAttempts(points, payloads).slice(0, FUZZ_MAX_ATTEMPTS);

    const attempts: FuzzAttemptResult[] = [];
    let requests = 1;
    for (const [index, { point, payload }] of planned.entries()) {
      if (signal?.aborted) {
        break;
      }
      if (delay > 0 && index > 0) {
        await sleep(delay);
      }
      const result: FuzzAttemptResult = { index: index + 1, pointId: point.id, position: point.label, payload: payload.value, statusCode: 0, bytes: 0, elapsed: 0, flags: [], notable: false, snippet: '' };
      try {
        const answer = await exchange({ fuzzAttempt: index + 1, fuzzPayload: payload.value, fuzzPosition: point.label }, { pointId: point.id, payload });
        if (!answer) {
          result.error = "The position wasn't in the request this time: a script changed it";
        } else {
          requests++;
          Object.assign(result, { statusCode: answer.statusCode, bytes: answer.bytes, elapsed: answer.elapsed, snippet: answer.body.slice(0, SNIPPET_CHARS), ...(answer.error ? { error: answer.error } : {}) });
          result.flags = judgeAttempt(baseline, answer, payload);
          result.notable = result.flags.some(({ notable }) => notable);
        }
      } catch (err) {
        if (signal?.aborted) {
          break;
        }
        result.error = err instanceof Error ? err.message : String(err);
      }
      attempts.push(result);
      onAttempt?.(result);
    }
    return {
      baseline: { statusCode: baseline.statusCode, bytes: baseline.bytes, elapsed: baseline.elapsed, ...(baseline.error ? { error: baseline.error } : {}) },
      attempts,
      notable: attempts.filter(({ notable }) => notable).length,
      requests,
      stopped: Boolean(signal?.aborted),
    };
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}
