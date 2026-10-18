import fs from 'fs';

import { database as db } from '../common/database';
import { RENDER_PURPOSE_SEND } from '../common/render';
import * as models from '../models';
import type { Request } from '../models/request';
import { isWorkspace } from '../models/workspace';
import { runPreRequestScript } from '../scripting/request-scripts';
import { type LoadSample, type LoadSummary, summarizeLoad } from './load-stats';
import {
  fetchRequestData,
  sendCurlAndWriteTimeline,
  transformedResponse,
  tryToInterpolateRequest,
  tryToTransformRequestWithPlugins,
} from './network';
import type { RunnableRequest } from './runner';

// A load test: virtual users, each sending the requests in order, again and
// again, until the time is up. Every send is a real one (render, scripts,
// plugins, libcurl, assertions), but nothing of it is kept: no response
// history, no body or timeline files, so a long test doesn't fill the disk.

export const MAX_VIRTUAL_USERS = 100;
export const MAX_DURATION_MS = 60 * 60 * 1000;
// the samples kept for the percentiles; a longer test counts on with these
const MAX_SAMPLES = 200_000;

export interface LoadOptions {
  // a sub environment's id; the workspace's active one when left out
  environmentId?: string;
  virtualUsers: number;
  durationMs: number;
  // the users start one after another over this long
  rampUpMs?: number;
  // each user waits this long after each request
  thinkTimeMs?: number;
  signal?: AbortSignal;
  // the numbers so far, about every second
  onProgress?: (summary: LoadSummary) => void;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  if (ms <= 0 || signal?.aborted) {
    resolve();
    return;
  }
  const timer = setTimeout(done, ms);
  function done() {
    clearTimeout(timer);
    signal?.removeEventListener('abort', done);
    resolve();
  }
  signal?.addEventListener('abort', done);
});

type RequestData = Awaited<ReturnType<typeof fetchRequestData>>;

async function loadSend(request: Request, data: RequestData, environmentId: string, iteration: number): Promise<LoadSample> {
  const started = Date.now();
  const files: string[] = [];
  try {
    const scripted = await runPreRequestScript(request, { environmentId, iteration });
    const renderResult = await tryToInterpolateRequest(scripted.request, environmentId, RENDER_PURPOSE_SEND, undefined, scripted.variables);
    const rendered = await tryToTransformRequestWithPlugins(renderResult);
    const response = await sendCurlAndWriteTimeline(rendered, data.clientCertificates, data.caCert, data.settings);
    files.push(response.timelinePath, ('bodyPath' in response && response.bodyPath) || '');
    const checked = await transformedResponse(response, environmentId, rendered, renderResult.context, { preRequestLogs: scripted.logs, iteration });
    files.push(checked.bodyPath || '');
    const statusCode = checked.error ? undefined : checked.statusCode;
    return {
      requestId: request._id,
      name: request.name,
      elapsed: checked.error ? Date.now() - started : checked.elapsedTime,
      ok: !checked.error && (statusCode ?? 0) < 400 && (checked.assertionResults || []).every(result => result.passed),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(checked.error ? { error: checked.error } : {}),
    };
  } catch (err) {
    // a render error, or a send the request policy refused
    return { requestId: request._id, name: request.name, elapsed: Date.now() - started, ok: false, error: (err as Error).message };
  } finally {
    await Promise.all([...new Set(files)].filter(Boolean).map(file => fs.promises.rm(file, { force: true }).catch(() => undefined)));
  }
}

export async function runLoadTest(requests: RunnableRequest[], options: LoadOptions): Promise<LoadSummary> {
  const { virtualUsers, durationMs, rampUpMs = 0, thinkTimeMs = 0, signal, onProgress } = options;
  if (!requests.length) {
    throw new Error('There are no requests to load test');
  }
  if (!Number.isInteger(virtualUsers) || virtualUsers < 1 || virtualUsers > MAX_VIRTUAL_USERS) {
    throw new Error(`Virtual users must be a whole number from 1 to ${MAX_VIRTUAL_USERS}`);
  }
  if (!(durationMs >= 1000 && durationMs <= MAX_DURATION_MS)) {
    throw new Error(`The duration must be from 1 second to ${MAX_DURATION_MS / 60_000} minutes`);
  }

  // what each send needs that doesn't change during the test, and the cookie
  // jar the users' first sends would otherwise all try to create
  const data = new Map<string, RequestData>();
  for (const { request } of requests) {
    data.set(request._id, await fetchRequestData(request._id));
    const workspace = (await db.withAncestors(request, [models.requestGroup.type, models.workspace.type])).find(isWorkspace);
    if (workspace) {
      await models.cookieJar.getOrCreateForParentId(workspace._id);
    }
  }
  const environmentId = options.environmentId ?? data.get(requests[0].request._id)!.environment._id;

  const started = Date.now();
  const ends = started + durationMs;
  const samples: LoadSample[] = [];
  let sent = 0;
  let failed = 0;
  const record = (sample: LoadSample) => {
    sent++;
    failed += sample.ok ? 0 : 1;
    // past the cap, each new sample replaces a random one, so the percentiles stay fair
    if (samples.length < MAX_SAMPLES) {
      samples.push(sample);
    } else {
      const index = Math.floor(Math.random() * sent);
      if (index < MAX_SAMPLES) {
        samples[index] = sample;
      }
    }
  };
  const isOver = () => Date.now() >= ends || !!signal?.aborted;
  const summary = () => {
    const result = summarizeLoad(samples, { virtualUsers, durationMs: Math.min(Date.now(), ends) - started, stopped: !!signal?.aborted && Date.now() < ends });
    // the real counts, when the samples are a part of them
    if (sent > samples.length) {
      result.requests = sent;
      result.failed = failed;
      result.errorRate = failed / sent;
      result.throughput = Math.round((sent / (result.durationMs / 1000)) * 10) / 10;
    }
    return result;
  };

  const user = async (index: number) => {
    await sleep((rampUpMs * index) / virtualUsers, signal);
    for (let iteration = 1; !isOver(); iteration++) {
      for (const { request } of requests) {
        if (isOver()) {
          return;
        }
        record(await loadSend(request, data.get(request._id)!, environmentId, iteration));
        await sleep(thinkTimeMs, signal);
      }
    }
  };

  const progress = onProgress ? setInterval(() => onProgress(summary()), 1000) : undefined;
  try {
    await Promise.all(Array.from({ length: virtualUsers }, (_, index) => user(index)));
  } finally {
    clearInterval(progress);
  }
  return summary();
}
