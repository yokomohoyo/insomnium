import path from 'path';
import type * as WorkerThreads from 'worker_threads';

// worker_threads, with Worker running the Spectral worker from its TypeScript
// source instead of the spectral-worker.min.js that esbuild.main.ts builds.
// Use as: jest.mock('worker_threads', () => jest.requireActual('<this file>').workerThreads)
const actual = jest.requireActual<typeof WorkerThreads>('worker_threads');
const source = path.join(__dirname, '../main/spectral-worker.ts');

class SpectralWorker extends actual.Worker {
  constructor() {
    super(`
      require(${JSON.stringify(require.resolve('esbuild-runner/register'))});
      require(${JSON.stringify(source)});
    `, { eval: true });
  }
}

export const workerThreads = { ...actual, Worker: SpectralWorker };
