// A sandboxed plugin, as the app's window has it (see protocol.ts): a Module
// made from the sandbox's manifest, whose tags, hooks and actions send calls
// with their context's data, and answer the plugin's calls back into it.
import type { Module } from '../index';
import type { PluginTheme } from '../misc';
import {
  cloneable,
  CONTEXT_METHODS,
  type ContextSnapshot,
  type EntryKind,
  type FromSandbox,
  type Manifest,
  REQUEST_DATA,
  RESPONSE_DATA,
  type SerializedError,
  type ToSandbox,
} from './protocol';

export interface SandboxPort {
  postMessage(message: ToSandbox): void;
  onmessage: ((event: { data: FromSandbox }) => void) | null;
  start?(): void;
  close?(): void;
}

// a tag or a hook that hasn't answered by then, unless it's waiting on the app (a prompt, say)
export const CALL_TIMEOUT = 30_000;

const CONTEXT_PARTS = ['app', 'store', 'network', 'data', 'request', 'response', 'util', 'context', 'meta', 'renderPurpose'];

export class PluginSandboxError extends Error {
  nodeModule?: string;

  constructor(error: SerializedError) {
    super(error.message);
    this.name = error.name || 'Error';
    this.stack = error.stack;
    this.nodeModule = error.nodeModule;
  }
}

type Result = Extract<FromSandbox, { type: 'result'; ok: true }>;
type AnyContext = Record<string | symbol, any>;

interface Call {
  resolve: (result: Result) => void;
  reject: (err: Error) => void;
  context: AnyContext;
  // the plugin's calls into its context still being answered
  answering: number;
  timer?: ReturnType<typeof setTimeout>;
}

const safely = <T>(get: () => T) => {
  try {
    return get();
  } catch {
    return undefined;
  }
};

// a context's data, for the sandbox: the parts it has, and what isn't a call
export function snapshotOf(context: AnyContext): ContextSnapshot {
  const snapshot: ContextSnapshot = { parts: CONTEXT_PARTS.filter(part => part in context) };
  if (context.app) {
    const desktop = safely(() => context.app.getPath('desktop'));
    snapshot.app = { info: cloneable(safely(() => context.app.getInfo())), paths: desktop ? { desktop } : {} };
  }
  const request = context[REQUEST_DATA];
  if (request) {
    snapshot.request = { renderedRequest: cloneable(request.renderedRequest), renderedContext: cloneable(request.renderedContext), readOnly: !!request.readOnly };
  }
  const response = context[RESPONSE_DATA];
  if (response) {
    const body = safely(() => context.response.getBody());
    snapshot.response = {
      parentId: response.parentId,
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      bytesRead: response.bytesRead,
      elapsedTime: response.elapsedTime,
      headers: cloneable(response.headers) as { name: string; value: string }[],
      body: body ? new Uint8Array(body) : null,
    };
  }
  for (const part of ['context', 'meta', 'renderPurpose'] as const) {
    if (part in context) {
      (snapshot as unknown as Record<string, unknown>)[part] = cloneable(context[part]);
    }
  }
  return snapshot;
}

export class SandboxedPlugin {
  readonly manifest: Promise<Manifest>;
  private ready!: { resolve: (manifest: Manifest) => void; reject: (err: Error) => void };
  private calls = new Map<number, Call>();
  private nextId = 1;
  private closed = false;

  constructor(private port: SandboxPort, readonly name: string, private onClose?: () => void, private timeout = CALL_TIMEOUT) {
    this.manifest = new Promise((resolve, reject) => {
      this.ready = { resolve, reject };
    });
    port.onmessage = ({ data }) => this.receive(data);
    port.start?.();
  }

  private receive(message: FromSandbox) {
    if (message.type === 'manifest') {
      this.ready.resolve(message.manifest);
    } else if (message.type === 'loadError') {
      this.ready.reject(new PluginSandboxError(message.error));
    } else if (message.type === 'result') {
      const call = this.calls.get(message.id);
      if (!call) {
        return;
      }
      this.calls.delete(message.id);
      clearTimeout(call.timer);
      if (message.ok) {
        call.resolve(message);
      } else {
        call.reject(new PluginSandboxError(message.error));
      }
    } else if (message.type === 'context') {
      this.answer(message);
    }
  }

  // the plugin calling into its context: one of CONTEXT_METHODS, on the context its call came with
  private async answer({ id, call: callId, method, args }: Extract<FromSandbox, { type: 'context' }>) {
    const call = this.calls.get(callId);
    if (call) {
      call.answering++;
    }
    try {
      if (!call || !(CONTEXT_METHODS as readonly string[]).includes(method)) {
        throw new Error(`${method} isn't something a plugin can call`);
      }
      const path = method.split('.');
      const owner = path.slice(0, -1).reduce<AnyContext | undefined>((target, key) => target?.[key], call.context);
      const fn = owner?.[path[path.length - 1]];
      if (typeof fn !== 'function') {
        throw new Error(`${method} isn't available here`);
      }
      const value = await fn.apply(owner, args);
      this.port.postMessage({ type: 'contextResult', id, ok: true, value: cloneable(value) });
    } catch (err) {
      this.port.postMessage({ type: 'contextResult', id, ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (call) {
        call.answering--;
      }
    }
  }

  // wait: an action, which can take as long as the user does
  async run(kind: EntryKind, index: number, args: unknown[], context: AnyContext, { action, wait = false }: { action?: number; wait?: boolean } = {}) {
    if (this.closed) {
      throw new Error(`The plugin ${this.name} has been unloaded`);
    }
    const id = this.nextId++;
    const result = await new Promise<Result>((resolve, reject) => {
      const call: Call = { resolve, reject, context, answering: 0 };
      const arm = () => {
        call.timer = setTimeout(() => {
          if (call.answering > 0) {
            return arm();
          }
          this.calls.delete(id);
          reject(new Error(`The plugin ${this.name} didn't answer in ${Math.round(this.timeout / 1000)} seconds`));
        }, this.timeout);
      };
      if (!wait) {
        arm();
      }
      this.calls.set(id, call);
      this.port.postMessage({ type: 'call', id, kind, index, action, args: args.map(arg => cloneable(arg)), context: snapshotOf(context) });
    });
    // what a hook changed, back onto the request and response the app goes on with
    const request = context[REQUEST_DATA];
    if (result.renderedRequest && request && !request.readOnly) {
      for (const [key, value] of Object.entries(result.renderedRequest as Record<string, unknown>)) {
        request.renderedRequest[key] = value;
      }
    }
    if (result.responseBody && context.response?.setBody) {
      context.response.setBody(Buffer.from(result.responseBody));
    }
    return result.value;
  }

  close() {
    this.closed = true;
    for (const call of this.calls.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(`The plugin ${this.name} was unloaded`));
    }
    this.calls.clear();
    this.port.close?.();
    this.onClose?.();
  }
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

// the plugin, as the app calls its plugins
export function moduleOf(manifest: Manifest, sandbox: SandboxedPlugin): Module {
  const actions = (kind: EntryKind, items: Manifest['requestActions']) => items.map((item, index) => ({
    ...item,
    action: (context: AnyContext, models: unknown) => sandbox.run(kind, index, [models], context, { wait: true }),
  }));
  return {
    templateTags: manifest.templateTags.map((tag, index) => ({
      ...tag,
      args: tag.args as any[],
      actions: tag.actions.map((item, action) => ({ ...item, run: (context: AnyContext) => sandbox.run('tagAction', index, [], context, { action, wait: true }) })),
      run: (context: AnyContext, ...args: unknown[]) => sandbox.run('templateTag', index, args, context),
    })),
    requestHooks: range(manifest.requestHooks).map(index => (context: AnyContext) => sandbox.run('requestHook', index, [], context)),
    responseHooks: range(manifest.responseHooks).map(index => (context: AnyContext) => sandbox.run('responseHook', index, [], context)),
    requestActions: actions('requestAction', manifest.requestActions),
    requestGroupActions: actions('requestGroupAction', manifest.requestGroupActions),
    workspaceActions: actions('workspaceAction', manifest.workspaceActions),
    documentActions: actions('documentAction', manifest.documentActions),
    themes: manifest.themes as PluginTheme[],
  } as Module;
}

const open = new Set<SandboxedPlugin>();

// a plugin without full access, in a sandbox of its own (main/plugin-sandbox.ts)
export async function loadSandboxedPlugin(directory: string, name: string): Promise<Module> {
  const { id, port } = await window.main.openPluginSandbox({ directory, name });
  const sandbox = new SandboxedPlugin(port as unknown as SandboxPort, name, () => window.main.closePluginSandbox(id));
  open.add(sandbox);
  try {
    return moduleOf(await sandbox.manifest, sandbox);
  } catch (err) {
    closeSandbox(sandbox);
    throw err;
  }
}

const closeSandbox = (sandbox: SandboxedPlugin) => {
  open.delete(sandbox);
  sandbox.close();
};

// before the plugins load again
export function closeSandboxes() {
  for (const sandbox of [...open]) {
    closeSandbox(sandbox);
  }
}
