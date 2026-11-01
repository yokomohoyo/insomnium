import type { ISpectralDiagnostic } from '@stoplight/spectral-core';
import { format } from 'util';
import { isMainThread, parentPort } from 'worker_threads';

import { runSpectral } from './spectral-run';

// Specs are linted on a worker thread: Spectral's work on a large spec is
// seconds of synchronous code, which on the main process held up every
// window's database calls meanwhile. This is the worker's entry point:
// esbuild.main.ts builds it to spectral-worker.min.js next to main.min.js, and
// main/spectral-lint.ts starts it.

export interface SpectralJob {
  id: number;
  contents: string;
  rulesetPath?: string;
}
export type SpectralReply = { id: number; diagnostics: ISpectralDiagnostic[] } | { id: number; error: string };
export interface SpectralWorkerLog {
  log: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  // This thread's console would only reach stdout and stderr, so pass it to
  // the main thread's, which the log file gets
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[level] = (...args: unknown[]) => port.postMessage({ log: level, text: format(...args) } satisfies SpectralWorkerLog);
  }
  port.on('message', async ({ id, contents, rulesetPath }: SpectralJob) => {
    let reply: SpectralReply;
    try {
      reply = { id, diagnostics: await runSpectral({ contents, rulesetPath }) };
    } catch (err) {
      reply = { id, error: err instanceof Error ? err.message : String(err) };
    }
    try {
      port.postMessage(reply);
    } catch (err) {
      // a reply that can't be cloned still has to settle the job
      port.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies SpectralReply);
    }
  });
}
