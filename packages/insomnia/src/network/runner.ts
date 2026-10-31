import { RENDER_PURPOSE_SEND } from '../common/render';
import { metaSortKeySort } from '../common/sorting';
import * as models from '../models';
import { isEventStreamRequest, type Request } from '../models/request';
import type { ResponseTimings } from '../models/response';
import { runPreRequestScript } from '../scripting/request-scripts';
import type { AssertionResult } from './assertions';
import {
  cancelCurlAndWriteTimeline,
  fetchRequestData,
  responseTransform,
  sendCurlAndWriteTimeline,
  tryToInterpolateRequest,
  tryToTransformRequestWithPlugins,
} from './network';

// The collection runner: sends a folder's or a workspace's HTTP requests in
// order, as Send does, checking each one's assertions. Responses are stored,
// so cookies and {% response %} chain from one request to the next.

export interface RunnableRequest {
  request: Request;
  // the folders it's in, outermost first
  folders: string[];
}

export interface RunResult {
  iteration: number;
  requestId: string;
  name: string;
  folders: string[];
  method: string;
  url?: string;
  responseId?: string;
  statusCode?: number;
  statusMessage?: string;
  elapsedTime?: number;
  // when each part of the exchange was done, as on a response
  timings?: ResponseTimings;
  // the body's size, as received
  bytes?: number;
  httpVersion?: string;
  error?: string;
  assertions: AssertionResult[];
  // sent, and every assertion passed
  passed: boolean;
}

export interface RunOptions {
  // a sub environment's id; the workspace's active one when left out
  environmentId?: string;
  iterations?: number;
  // a row of variables for each iteration, over the environment's
  data?: Record<string, unknown>[];
  // milliseconds between requests
  delay?: number;
  // stop at the first request that fails
  bail?: boolean;
  onResult?: (result: RunResult) => void;
  // stops the run, cancelling the request in flight
  signal?: AbortSignal;
}

export interface RunSummary {
  iterations: number;
  results: RunResult[];
  requests: { total: number; failed: number };
  assertions: { total: number; failed: number };
  elapsedTime: number;
  bailed: boolean;
  // stopped by its signal
  stopped: boolean;
}

// The HTTP requests under a workspace or folder, in the sidebar's (manual) order
export async function listRunnableRequests(parentId: string, folders: string[] = []): Promise<RunnableRequest[]> {
  const children = [
    ...await models.requestGroup.findByParentId(parentId),
    ...await models.request.findByParentId(parentId),
  ].sort(metaSortKeySort);
  const runnable: RunnableRequest[] = [];
  for (const child of children) {
    if (models.requestGroup.isRequestGroup(child)) {
      runnable.push(...await listRunnableRequests(child._id, [...folders, child.name]));
    } else {
      runnable.push({ request: child as Request, folders });
    }
  }
  return runnable;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// why a request can't be sent as a run sends it: an event stream never ends
export const notRunnable = (request: Pick<Request, 'type' | 'headers'>) => isEventStreamRequest(request)
  ? "not run: event streams aren't supported by the runner"
  : undefined;

// Stop ends the run at once: the send in flight is cancelled and its result dropped
class Stopped extends Error {}
const untilStopped = <T>(promise: Promise<T>, signal: AbortSignal | undefined, onStop: () => void) => signal
  ? new Promise<T>((resolve, reject) => {
    const stop = () => {
      onStop();
      reject(new Stopped());
    };
    if (signal.aborted) {
      return stop();
    }
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  })
  : promise;

export async function sendForRun(request: Request, { environmentId, iterationData, iteration }: { environmentId?: string; iterationData?: Record<string, unknown>; iteration?: number }) {
  const unsupported = notRunnable(request);
  if (unsupported) {
    throw new Error(unsupported);
  }
  const { environment, settings, clientCertificates, caCert } = await fetchRequestData(request._id);
  const envId = environmentId ?? environment._id;
  const scripted = await runPreRequestScript(request, { environmentId: envId, iterationData, iteration });
  const renderResult = await tryToInterpolateRequest(scripted.request, envId, RENDER_PURPOSE_SEND, undefined, { ...iterationData, ...scripted.variables });
  const renderedRequest = await tryToTransformRequestWithPlugins(renderResult);
  const response = await sendCurlAndWriteTimeline(renderedRequest, clientCertificates, caCert, settings);
  const patch = await responseTransform(response, envId, renderedRequest, renderResult.context, { preRequestLogs: scripted.logs, iterationData, iteration });
  const stored = await models.response.create(patch, settings.maxHistoryResponses);
  await models.requestMeta.updateOrCreateByParentId(request._id, { activeResponseId: stored._id });
  return { stored, url: renderedRequest.url };
}

export async function runRequests(requests: RunnableRequest[], options: RunOptions = {}): Promise<RunSummary> {
  const { environmentId, data, delay = 0, bail = false, onResult, signal } = options;
  const iterations = Math.max(1, options.iterations ?? (data?.length || 1));
  const started = Date.now();
  const results: RunResult[] = [];
  let bailed = false;

  run: for (let iteration = 1; iteration <= iterations; iteration++) {
    const iterationData = data?.length ? data[(iteration - 1) % data.length] : undefined;
    for (const [index, { request, folders }] of requests.entries()) {
      if (delay > 0 && (iteration > 1 || index > 0)) {
        await sleep(delay);
      }
      if (signal?.aborted) {
        break run;
      }
      const base = { iteration, requestId: request._id, name: request.name, folders, method: request.method };
      let result: RunResult;
      try {
        const { stored, url } = await untilStopped(sendForRun(request, { environmentId, iterationData, iteration }), signal, () => cancelCurlAndWriteTimeline(request._id));
        const assertions = stored.assertionResults || [];
        result = {
          ...base,
          url,
          responseId: stored._id,
          statusCode: stored.statusCode,
          statusMessage: stored.statusMessage,
          elapsedTime: stored.elapsedTime,
          ...(stored.timings ? { timings: stored.timings } : {}),
          ...(stored.error ? {} : { bytes: stored.bytesRead, httpVersion: stored.httpVersion }),
          ...(stored.error ? { error: stored.error } : {}),
          assertions,
          passed: !stored.error && assertions.every(assertion => assertion.passed),
        };
      } catch (err) {
        if (err instanceof Stopped) {
          break run;
        }
        // a render error, a send the request policy refused, or one the runner can't make
        result = { ...base, error: (err as Error).message, assertions: [], passed: false };
      }
      results.push(result);
      onResult?.(result);
      if (bail && !result.passed) {
        bailed = true;
        break run;
      }
    }
  }

  const assertions = results.flatMap(result => result.assertions);
  return {
    iterations,
    results,
    requests: { total: results.length, failed: results.filter(result => !result.passed).length },
    assertions: { total: assertions.length, failed: assertions.filter(assertion => !assertion.passed).length },
    elapsedTime: Date.now() - started,
    bailed,
    stopped: !!signal?.aborted,
  };
}
