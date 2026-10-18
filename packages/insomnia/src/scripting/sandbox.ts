import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from 'quickjs-emscripten-core';

import { PRELUDE } from './prelude';

// Scripts run in QuickJS, compiled to WebAssembly: a JavaScript engine of its
// own, with no Node, DOM or network, so a script from a shared collection
// can't reach the app or the computer. It gets the data it's given and the
// API in prelude.ts, and hands its changes back as data.

export interface ScriptLog {
  level: string;
  message: string;
}

export interface SandboxResult<T> {
  output?: T;
  logs: ScriptLog[];
  error?: string;
}

const TIMEOUT_MS = 10_000;
const MEMORY_BYTES = 64 * 1024 * 1024;
const MAX_LOGS = 500;
const MAX_LOG_LENGTH = 10_000;

// loaded on the first script: the engine is about a megabyte
type Core = typeof import('quickjs-emscripten-core');
let engine: Promise<{ module: QuickJSWASMModule; shouldInterruptAfterDeadline: Core['shouldInterruptAfterDeadline'] }> | null = null;
const loadEngine = () => {
  if (!engine) {
    engine = (async () => {
      const { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } = await import('quickjs-emscripten-core');
      const { default: variant } = await import('@jitl/quickjs-singlefile-cjs-release-sync');
      return { module: await newQuickJSWASMModuleFromVariant(variant), shouldInterruptAfterDeadline };
    })();
  }
  return engine;
};

// What a script threw, as one line
const describeError = (vm: QuickJSContext, handle: QuickJSHandle, timeoutMs: number) => {
  const error = vm.dump(handle);
  if (error && typeof error === 'object') {
    if (error.message === 'interrupted') {
      return `It ran for more than ${timeoutMs / 1000} seconds`;
    }
    const line = /script\.js:(\d+)/.exec(String(error.stack || ''))?.[1];
    return `${error.name || 'Error'}: ${error.message}${line ? ` (line ${Number(line) - 1})` : ''}`;
  }
  return String(error);
};

export async function runInSandbox<T>(code: string, input: object, { timeoutMs = TIMEOUT_MS } = {}): Promise<SandboxResult<T>> {
  const { module, shouldInterruptAfterDeadline } = await loadEngine();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(MEMORY_BYTES);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const vm = runtime.newContext();
  const logs: ScriptLog[] = [];
  try {
    const log = vm.newFunction('__log', (level: QuickJSHandle, message: QuickJSHandle) => {
      if (logs.length < MAX_LOGS) {
        logs.push({ level: vm.getString(level), message: vm.getString(message).slice(0, MAX_LOG_LENGTH) });
      }
    });
    vm.setProp(vm.global, '__log', log);
    log.dispose();
    const inputHandle = vm.newString(JSON.stringify(input));
    vm.setProp(vm.global, '__input', inputHandle);
    inputHandle.dispose();

    const prelude = vm.evalCode(PRELUDE, 'prelude.js');
    if (prelude.error) {
      const error = describeError(vm, prelude.error, timeoutMs);
      prelude.error.dispose();
      throw new Error(`The script API failed to load: ${error}`);
    }
    prelude.value.dispose();

    // the script is the body of an async function, so it can await; its tests
    // can be async too
    const started = vm.evalCode(`(async () => {\n${code}\n})().then(() => __pending())`, 'script.js');
    if (started.error) {
      const error = describeError(vm, started.error, timeoutMs);
      started.error.dispose();
      return { logs, error };
    }
    const settled = vm.resolvePromise(started.value);
    started.value.dispose();
    let done = false;
    settled.finally(() => {
      done = true;
    });
    // run the script's jobs until its promise settles; nothing it can await
    // waits on the host, so this ends unless the script is still busy at the deadline
    while (!done) {
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        const error = describeError(vm, jobs.error, timeoutMs);
        jobs.error.dispose();
        return { logs, error };
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!done && Date.now() > deadline) {
        return { logs, error: `It ran for more than ${timeoutMs / 1000} seconds` };
      }
    }
    const result = await settled;
    if (result.error) {
      const error = describeError(vm, result.error, timeoutMs);
      result.error.dispose();
      return { logs, error };
    }
    result.value.dispose();

    const output = vm.evalCode('__output()');
    if (output.error) {
      const error = describeError(vm, output.error, timeoutMs);
      output.error.dispose();
      return { logs, error };
    }
    const json = vm.getString(output.value);
    output.value.dispose();
    return { output: JSON.parse(json) as T, logs };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
