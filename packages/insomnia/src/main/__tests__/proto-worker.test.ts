import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type * as WorkerThreads from 'worker_threads';

import { loadProto, readRegularFileSync, validateProto } from '../proto-worker';

// Stand-in workers: the source to run is set per test.
const mockWorker = { source: '', started: 0 };
jest.mock('worker_threads', () => {
  const actual = jest.requireActual('worker_threads') as typeof WorkerThreads;
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor() {
        super(mockWorker.source, { eval: true });
        mockWorker.started++;
      }
    },
  };
});

describe('proto worker', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects pending jobs when the worker exits', async () => {
    mockWorker.source = 'process.exit(3)';

    await expect(validateProto('/a.proto', [])).rejects.toThrow('Proto worker exited with code 3');
  });

  it('rejects pending jobs when the worker throws, and starts a new one for the next job', async () => {
    mockWorker.source = 'throw new Error("cannot start")';

    await expect(Promise.all([loadProto('/a.proto', []), validateProto('/b.proto', [])])).rejects.toThrow('cannot start');
    await expect(loadProto('/a.proto', [])).rejects.toThrow('cannot start');
  });

  it('rejects pending jobs when the worker stops answering, and starts a new one for the next job', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockWorker.source = 'require("worker_threads").parentPort.on("message", () => {})';
    const jobs = Promise.all([validateProto('/a.proto', []), loadProto('/b.proto', [])]);
    const started = mockWorker.started;

    jest.advanceTimersByTime(60_000);

    await expect(jobs).rejects.toThrow('Loading the proto file timed out after 60 seconds');
    mockWorker.source = `
      const { parentPort } = require('worker_threads');
      parentPort.on('message', ({ id, filePath }) => parentPort.postMessage({ id, error: { message: 'answered ' + filePath } }));
    `;
    await expect(validateProto('/c.proto', [])).resolves.toEqual({ message: 'answered /c.proto' });
    expect(mockWorker.started).toBe(started + 1);
  });

  // Electron can only open a file inside app.asar by copying it to the temp dir
  it('reads a file inside an asar archive by path instead of opening it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-worker-'));
    const file = path.join(dir, 'app.asar', 'descriptor.proto');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, 'syntax = "proto2";');
    const readFileSync = jest.spyOn(fs, 'readFileSync');
    try {
      expect(readRegularFileSync(file).toString()).toBe('syntax = "proto2";');
      expect(readFileSync.mock.calls).toEqual([[file]]);
    } finally {
      readFileSync.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
