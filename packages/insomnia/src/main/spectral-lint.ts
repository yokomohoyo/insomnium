import type { ISpectralDiagnostic } from '@stoplight/spectral-core';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

import type { SpectralJob, SpectralReply, SpectralWorkerLog } from './spectral-worker';

// A spec's lint results, with the ruleset at rulesetPath (a file chosen for the
// document, or its git repository's .spectral.yaml) or the built-in OpenAPI or
// AsyncAPI rules. A ruleset that can't be used is said first, as a warning, rather than
// quietly linting with the built-in rules instead.
export async function lintSpec(options: { contents: string; rulesetPath?: string }): Promise<ISpectralDiagnostic[]> {
  const key = await lintKey(options);
  let result = recentLints.get(key);
  if (!result) {
    result = lintOnWorker(options);
    result.catch(() => recentLints.delete(key));
    if (recentLints.size >= RECENT_LINTS) {
      recentLints.delete(recentLints.keys().next().value!);
    }
  }
  // the most recent last
  recentLints.delete(key);
  recentLints.set(key, result);
  return result;
}

// The last few results, by the text and the ruleset's: after an edit the Spec
// tab's loader and its editor each lint the same text, and the loader again on
// every revalidation (any request saved), each taking seconds on a large spec
// and holding up the main process meanwhile.
const recentLints = new Map<string, Promise<ISpectralDiagnostic[]>>();
const RECENT_LINTS = 4;

const lintKey = async ({ contents, rulesetPath }: { contents: string; rulesetPath?: string }) => {
  let ruleset = '';
  if (rulesetPath) {
    // (one that can be used extends only built-in rulesets, so it's all in this file)
    ruleset = await fs.promises.readFile(rulesetPath, 'utf8').then(source => `${rulesetPath}\n${source}`, () => `${rulesetPath} unreadable`);
  }
  return `${ruleset}\0${contents}`;
};

// One worker, started by the first lint and ended after a minute without one,
// which lets go of Spectral and the last spec's documents. Unref'd so it never
// keeps the process alive.
const IDLE_MS = 60_000;

interface SpectralWorker {
  thread: Worker;
  pending: Map<number, { resolve: (diagnostics: ISpectralDiagnostic[]) => void; reject: (err: Error) => void }>;
  idle?: ReturnType<typeof setTimeout>;
}
let worker: SpectralWorker | undefined;
let nextJobId = 0;

// every lint settles: a crash or an exit rejects whatever is still pending
const failWorker = (w: SpectralWorker, err: Error) => {
  clearTimeout(w.idle);
  if (worker === w) {
    worker = undefined;
  }
  w.pending.forEach(({ reject }) => reject(err));
  w.pending.clear();
};

const startWorker = () => {
  const thread = new Worker(path.join(__dirname, 'spectral-worker.min.js'));
  const w: SpectralWorker = { thread, pending: new Map() };
  thread.on('message', (reply: SpectralReply | SpectralWorkerLog) => {
    if ('log' in reply) {
      console[reply.log](reply.text);
      return;
    }
    const job = w.pending.get(reply.id);
    w.pending.delete(reply.id);
    if ('error' in reply) {
      job?.reject(new Error(reply.error));
    } else {
      job?.resolve(reply.diagnostics);
    }
    if (!w.pending.size) {
      w.idle = setTimeout(() => {
        failWorker(w, new Error('The Spectral worker was ended'));
        thread.terminate();
      }, IDLE_MS);
      w.idle.unref?.();
    }
  });
  thread.on('messageerror', err => {
    failWorker(w, err);
    thread.terminate();
  });
  thread.on('error', err => failWorker(w, err));
  thread.on('exit', code => failWorker(w, new Error(`The Spectral worker exited with code ${code}`)));
  thread.unref();
  return w;
};

const lintOnWorker = (options: { contents: string; rulesetPath?: string }) => new Promise<ISpectralDiagnostic[]>((resolve, reject) => {
  const w = worker = worker || startWorker();
  clearTimeout(w.idle);
  const id = nextJobId++;
  w.pending.set(id, { resolve, reject });
  const job: SpectralJob = { id, contents: options.contents, rulesetPath: options.rulesetPath };
  w.thread.postMessage(job);
});
