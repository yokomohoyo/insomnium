// A plugin in its sandbox (see protocol.ts): loaded with a CommonJS require of
// its own, which reads the plugin's files through the main process and has no
// Node.js modules, and given its context as data and calls back to the app.
// This runs in the sandbox's page, without Node.js.
import { init as requestContext } from '../context/request';
import { SandboxBuffer } from './buffer';
import {
  cloneable,
  type ContextSnapshot,
  type FromSandbox,
  type Manifest,
  type ResponseSnapshot,
  serializeError,
  type ToSandbox,
} from './protocol';

// reads a file of the plugin's, or null when there's none; paths with forward slashes
export interface FileSource {
  read(file: string): string | null;
}

export interface Port {
  postMessage(message: FromSandbox): void;
  onmessage: ((event: { data: ToSandbox }) => void) | null;
}

const NODE_MODULES = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'domain', 'electron', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm',
  'wasi', 'worker_threads', 'zlib',
]);

export class NodeModuleError extends Error {
  nodeModule: string;

  constructor(nodeModule: string) {
    super(`It needs Node.js's ${nodeModule} module, which plugins don't have without full access.`);
    this.name = 'NodeModuleError';
    this.nodeModule = nodeModule;
  }
}

// paths with forward slashes, a Windows drive letter kept
const splitDrive = (file: string) => {
  const drive = /^[A-Za-z]:/.exec(file)?.[0] || '';
  return [drive, file.slice(drive.length)];
};
export function normalize(file: string) {
  const [drive, rest] = splitDrive(file.replace(/\\/g, '/'));
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part && part !== '.') {
      parts.push(part);
    }
  }
  return `${drive}/${parts.join('/')}`;
}
const dirname = (file: string) => {
  const [drive, rest] = splitDrive(file);
  const index = rest.lastIndexOf('/');
  return index <= 0 ? `${drive}/` : drive + rest.slice(0, index);
};
const join = (...parts: string[]) => normalize(parts.join('/'));

interface CommonJsModule {
  exports: unknown;
}

// A require for the plugin at root: relative files, and packages found up the
// node_modules folders as Node finds them, with .js, .json, folders' index.js
// and package.json main; no Node.js modules (a NodeModuleError instead)
export function createRequire(source: FileSource, root: string) {
  const texts = new Map<string, string | null>();
  const read = (file: string) => {
    if (!texts.has(file)) {
      texts.set(file, source.read(file));
    }
    return texts.get(file) ?? null;
  };
  const cache = new Map<string, CommonJsModule>();

  const asFile = (file: string) => [file, `${file}.js`, `${file}.json`, `${file}.cjs`].find(candidate => read(candidate) !== null) || null;
  const asFolder = (folder: string) => {
    const pkg = read(`${folder}/package.json`);
    if (pkg) {
      let main: unknown;
      try {
        const json = JSON.parse(pkg);
        const dot = json.exports?.['.'] ?? json.exports;
        main = typeof dot === 'string' ? dot : dot?.require ?? dot?.default ?? json.main;
        if (typeof main !== 'string') {
          main = json.main;
        }
      } catch {
        main = undefined;
      }
      if (typeof main === 'string') {
        const target = join(folder, main);
        const found = asFile(target) || asFile(`${target}/index`);
        if (found) {
          return found;
        }
      }
    }
    return asFile(`${folder}/index`);
  };

  const resolve = (from: string, request: string) => {
    const name = request.replace(/^node:/, '');
    if (request.startsWith('node:') || NODE_MODULES.has(name.split('/')[0])) {
      throw new NodeModuleError(name);
    }
    if (/^\.\.?(\/|$)/.test(request) || request.startsWith('/')) {
      const target = request.startsWith('/') ? normalize(request) : join(from, request);
      const found = asFile(target) || asFolder(target);
      if (found) {
        return found;
      }
    } else {
      for (let dir = from; ; dir = dirname(dir)) {
        if (!dir.endsWith('/node_modules')) {
          const target = join(dir, 'node_modules', request);
          const found = asFile(target) || asFolder(target);
          if (found) {
            return found;
          }
        }
        if (dirname(dir) === dir) {
          break;
        }
      }
    }
    throw new Error(`Cannot find module '${request}' from ${from}`);
  };

  const load = (file: string): unknown => {
    const cached = cache.get(file);
    if (cached) {
      return cached.exports;
    }
    const module: CommonJsModule = { exports: {} };
    cache.set(file, module);
    const text = read(file) || '';
    if (file.endsWith('.json')) {
      module.exports = JSON.parse(text);
    } else {
      const dir = dirname(file);
      // eslint-disable-next-line no-new-func -- the plugin's own code, in its sandbox
      const run = new Function('exports', 'require', 'module', '__filename', '__dirname', 'Buffer', 'global', `${text}\n//# sourceURL=${file}`);
      run.call(module.exports, module.exports, (request: string) => load(resolve(dir, request)), module, file, dir, SandboxBuffer, globalThis);
    }
    return module.exports;
  };

  return () => {
    const main = asFolder(normalize(root));
    if (!main) {
      throw new Error(`The plugin at ${root} has no main file`);
    }
    return load(main);
  };
}

const unsupported = (what: string) => () => {
  throw new Error(`${what} isn't available to plugins without full access.`);
};

// a response's body, as plugins have it: a Buffer
const bodyOf = (body: Uint8Array | null) => (body ? SandboxBuffer.from(body) : null);

function responseContext(snapshot: ResponseSnapshot) {
  let body = bodyOf(snapshot.body);
  let changed = false;
  const headers = snapshot.headers || [];
  const response = {
    getRequestId: () => snapshot.parentId || '',
    getStatusCode: () => snapshot.statusCode || 0,
    getStatusMessage: () => snapshot.statusMessage || '',
    getBytesRead: () => snapshot.bytesRead || 0,
    getTime: () => snapshot.elapsedTime || 0,
    getBody: () => body,
    getBodyStream: unsupported('response.getBodyStream'),
    setBody(next: Uint8Array | string) {
      body = SandboxBuffer.from(next);
      changed = true;
    },
    getHeader(name: string): string | string[] | null {
      const matched = headers.filter(header => header.name.toLowerCase() === name.toLowerCase());
      return matched.length > 1 ? matched.map(header => header.value) : matched.length ? matched[0].value : null;
    },
    getHeaders: () => headers.map(({ name, value }) => ({ name, value })),
    hasHeader: (name: string) => response.getHeader(name) !== null,
  };
  return { response, changedBody: () => (changed && body ? new Uint8Array(body) : undefined) };
}

type CallBack = (method: string, args: unknown[]) => Promise<unknown>;

// the context a plugin's function gets, rebuilt from the call's data
function buildContext(snapshot: ContextSnapshot, callBack: CallBack) {
  const call = (method: string) => (...args: unknown[]) => callBack(method, args.map(arg => cloneable(arg)));
  const has = (part: string) => snapshot.parts.includes(part);
  const context: Record<string, unknown> = {};
  let request: { renderedRequest: unknown } | undefined;
  let response: ReturnType<typeof responseContext> | undefined;

  if (has('app')) {
    context.app = {
      alert: call('app.alert'),
      prompt: call('app.prompt'),
      showSaveDialog: call('app.showSaveDialog'),
      getPath: (name: string) => snapshot.app?.paths[String(name).toLowerCase()] ?? unsupported(`app.getPath('${name}')`)(),
      getInfo: () => snapshot.app?.info,
      clipboard: { readText: call('app.clipboard.readText'), writeText: call('app.clipboard.writeText'), clear: call('app.clipboard.clear') },
      dialog: unsupported('app.dialog'),
      showGenericModalDialog: unsupported('app.showGenericModalDialog'),
    };
  }
  if (has('store')) {
    context.store = Object.fromEntries(['hasItem', 'setItem', 'getItem', 'removeItem', 'clear', 'all'].map(name => [name, call(`store.${name}`)]));
  }
  if (has('network')) {
    context.network = { sendRequest: call('network.sendRequest') };
  }
  if (has('data')) {
    context.data = {
      import: { uri: call('data.import.uri'), raw: call('data.import.raw') },
      export: { insomnia: call('data.export.insomnia'), har: call('data.export.har') },
    };
  }
  if (has('request') && snapshot.request) {
    const renderedRequest = snapshot.request.renderedRequest as Parameters<typeof requestContext>[0];
    context.request = requestContext(renderedRequest, snapshot.request.renderedContext as Record<string, unknown>, snapshot.request.readOnly).request;
    request = { renderedRequest };
  }
  if (has('response') && snapshot.response) {
    response = responseContext(snapshot.response);
    context.response = response.response;
  }
  if (has('util')) {
    const model = (path: string) => call(`util.models.${path}`);
    context.util = {
      render: call('util.render'),
      models: {
        request: { getById: model('request.getById'), getAncestors: model('request.getAncestors') },
        workspace: { getById: model('workspace.getById') },
        oAuth2Token: { getByRequestId: model('oAuth2Token.getByRequestId') },
        cookieJar: { getOrCreateForWorkspace: model('cookieJar.getOrCreateForWorkspace') },
        response: {
          getLatestForRequestId: model('response.getLatestForRequestId'),
          getBodyBuffer: async (...args: unknown[]) => bodyOf((await model('response.getBodyBuffer')(...args)) as Uint8Array | null),
        },
      },
    };
  }
  for (const part of ['context', 'meta', 'renderPurpose'] as const) {
    if (has(part)) {
      context[part] = snapshot[part];
    }
  }
  return { context, request, response };
}

type Fn = (...args: unknown[]) => unknown;
interface PluginModule {
  templateTags?: { name: string; displayName?: unknown; description?: string; args?: unknown[]; actions?: { name: string; icon?: string; run: Fn }[]; priority?: number; deprecated?: boolean; run: Fn }[];
  requestHooks?: Fn[];
  responseHooks?: Fn[];
  requestActions?: { label: string; icon?: string; action: Fn }[];
  requestGroupActions?: { label: string; icon?: string; action: Fn }[];
  workspaceActions?: { label: string; icon?: string; action: Fn }[];
  documentActions?: { label: string; hideAfterClick?: boolean; action: Fn }[];
  themes?: unknown[];
}

const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
const actions = (items: { label: string; icon?: string; hideAfterClick?: boolean }[] | undefined) =>
  list(items).map(({ label, icon, hideAfterClick }) => ({ label: String(label), icon, hideAfterClick }));

// what the app is told the plugin has: data only, a tag's functions (a
// display name or a hide worked out from the arguments) left behind
export function manifestOf(plugin: PluginModule): Manifest {
  return {
    templateTags: list(plugin.templateTags).map(tag => ({
      name: String(tag.name),
      displayName: typeof tag.displayName === 'string' ? tag.displayName : String(tag.name),
      description: String(tag.description || ''),
      args: cloneable(list(tag.args)) as unknown[],
      actions: list(tag.actions).map(({ name, icon }) => ({ name: String(name), icon })),
      priority: tag.priority,
      deprecated: tag.deprecated,
    })),
    requestHooks: list(plugin.requestHooks).length,
    responseHooks: list(plugin.responseHooks).length,
    requestActions: actions(plugin.requestActions),
    requestGroupActions: actions(plugin.requestGroupActions),
    workspaceActions: actions(plugin.workspaceActions),
    documentActions: actions(plugin.documentActions),
    themes: cloneable(list(plugin.themes)) as unknown[],
  };
}

function entryOf(plugin: PluginModule, message: Extract<ToSandbox, { type: 'call' }>): Fn {
  const { kind, index } = message;
  const tag = list(plugin.templateTags)[index];
  const found = {
    templateTag: () => tag?.run,
    tagAction: () => list(tag?.actions)[message.action ?? -1]?.run,
    requestHook: () => list(plugin.requestHooks)[index],
    responseHook: () => list(plugin.responseHooks)[index],
    requestAction: () => list(plugin.requestActions)[index]?.action,
    requestGroupAction: () => list(plugin.requestGroupActions)[index]?.action,
    workspaceAction: () => list(plugin.workspaceActions)[index]?.action,
    documentAction: () => list(plugin.documentActions)[index]?.action,
  }[kind]();
  if (typeof found !== 'function') {
    throw new Error(`The plugin has no ${kind} ${index}`);
  }
  return found;
}

// loads the plugin, tells the app what it has, and answers its calls
export function startRuntime(port: Port, source: FileSource, root: string) {
  let plugin: PluginModule;
  try {
    plugin = createRequire(source, root)() as PluginModule;
    port.postMessage({ type: 'manifest', manifest: manifestOf(plugin || {}) });
  } catch (err) {
    port.postMessage({ type: 'loadError', error: serializeError(err) });
    return;
  }

  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  port.onmessage = async ({ data: message }) => {
    if (message.type === 'contextResult') {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok) {
        waiting?.resolve(message.value);
      } else {
        waiting?.reject(new Error(message.error));
      }
      return;
    }
    if (message.type !== 'call') {
      return;
    }
    const callBack: CallBack = (method, args) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      port.postMessage({ type: 'context', id, call: message.id, method, args });
    });
    try {
      const fn = entryOf(plugin, message);
      const { context, request, response } = buildContext(message.context, callBack);
      // a tag gets its arguments after the context; an action its models
      const value = await fn(context, ...message.args);
      port.postMessage({
        type: 'result',
        id: message.id,
        ok: true,
        value: cloneable(value),
        renderedRequest: request && !message.context.request?.readOnly ? cloneable(request.renderedRequest) : undefined,
        responseBody: response?.changedBody(),
      });
    } catch (err) {
      port.postMessage({ type: 'result', id: message.id, ok: false, error: serializeError(err) });
    }
  };
}
