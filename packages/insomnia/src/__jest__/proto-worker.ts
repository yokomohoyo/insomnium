import path from 'path';
import type * as WorkerThreads from 'worker_threads';

// worker_threads, with Worker running the proto worker from its TypeScript
// source instead of the proto-worker.min.js that esbuild.main.ts builds.
// Use as: jest.mock('worker_threads', () => jest.requireActual('<this file>').workerThreads)
const actual = jest.requireActual<typeof WorkerThreads>('worker_threads');
const source = path.join(__dirname, '../main/proto-worker.ts');

class ProtoWorker extends actual.Worker {
  constructor() {
    super(`
      require(${JSON.stringify(require.resolve('esbuild-runner/register'))});
      require(${JSON.stringify(source)});
    `, { eval: true });
  }
}

export const workerThreads = { ...actual, Worker: ProtoWorker };

// A proto with enough messages that parsing it takes over a hundred milliseconds.
export const largeProtoText = () => {
  const fields = Array.from({ length: 8 }, (_, i) => `string f${i} = ${i + 1};`).join(' ');
  const messages = Array.from({ length: 4000 }, (_, i) => `message M${i} { ${fields} }`).join('\n');
  return `syntax = "proto3";\npackage big;\n${messages}\nservice S { rpc Call(M0) returns (M1); }\n`;
};

// Runs a task and reports the longest time the event loop went without a turn.
export const longestStallDuring = async <T>(task: () => Promise<T>) => {
  let longestStall = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    longestStall = Math.max(longestStall, now - last);
    last = now;
    timer = setTimeout(tick, 1);
  };
  let timer = setTimeout(tick, 1);
  const start = performance.now();
  try {
    const result = await task();
    const end = performance.now();
    return { result, elapsed: end - start, longestStall: Math.max(longestStall, end - last) };
  } finally {
    clearTimeout(timer);
  }
};
