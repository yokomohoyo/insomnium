// What passes between the app and a sandboxed plugin, over a MessagePort.
//
// A plugin without full access runs in a window of its own, sandboxed by the
// OS and Chromium, with no Node.js and no network (main/plugin-sandbox.ts).
// The app gets a manifest of what the plugin offers; calling one (a template
// tag, a hook, an action) sends a call with the plugin context's data, and
// the plugin's calls back into its context (store, alerts, sendRequest…) come
// back as context messages, which the app answers. Everything crossing is
// data: functions are left behind (cloneable below).

export type EntryKind =
  | 'templateTag'
  | 'tagAction'
  | 'requestHook'
  | 'responseHook'
  | 'requestAction'
  | 'requestGroupAction'
  | 'workspaceAction'
  | 'documentAction';

export interface TagManifest {
  name: string;
  displayName: string;
  description: string;
  args: unknown[];
  actions: { name: string; icon?: string }[];
  priority?: number;
  deprecated?: boolean;
}

export interface ActionManifest {
  label: string;
  icon?: string;
  hideAfterClick?: boolean;
}

export interface Manifest {
  templateTags: TagManifest[];
  requestHooks: number;
  responseHooks: number;
  requestActions: ActionManifest[];
  requestGroupActions: ActionManifest[];
  workspaceActions: ActionManifest[];
  documentActions: ActionManifest[];
  themes: unknown[];
}

export interface ResponseSnapshot {
  parentId?: string;
  statusCode?: number;
  statusMessage?: string;
  bytesRead?: number;
  elapsedTime?: number;
  headers?: { name: string; value: string }[];
  body: Uint8Array | null;
}

// a plugin context as data: the parts its call had, and the values that
// aren't calls back to the app
export interface ContextSnapshot {
  parts: string[];
  app?: { info: unknown; paths: Record<string, string> };
  request?: { renderedRequest: unknown; renderedContext: unknown; readOnly: boolean };
  response?: ResponseSnapshot;
  context?: unknown;
  meta?: unknown;
  renderPurpose?: string;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  // the Node.js module a plugin asked for, which a sandbox hasn't
  nodeModule?: string;
}

export type ToSandbox =
  | { type: 'call'; id: number; kind: EntryKind; index: number; action?: number; args: unknown[]; context: ContextSnapshot }
  | { type: 'contextResult'; id: number; ok: true; value: unknown }
  | { type: 'contextResult'; id: number; ok: false; error: string };

export type FromSandbox =
  | { type: 'manifest'; manifest: Manifest }
  | { type: 'loadError'; error: SerializedError }
  | { type: 'result'; id: number; ok: true; value: unknown; renderedRequest?: unknown; responseBody?: Uint8Array }
  | { type: 'result'; id: number; ok: false; error: SerializedError }
  | { type: 'context'; id: number; call: number; method: string; args: unknown[] };

// what a plugin may call back into its context for: nothing else is answered
export const CONTEXT_METHODS = [
  'app.alert',
  'app.prompt',
  'app.showSaveDialog',
  'app.clipboard.readText',
  'app.clipboard.writeText',
  'app.clipboard.clear',
  'store.hasItem',
  'store.setItem',
  'store.getItem',
  'store.removeItem',
  'store.clear',
  'store.all',
  'network.sendRequest',
  'data.import.uri',
  'data.import.raw',
  'data.export.insomnia',
  'data.export.har',
  'util.render',
  'util.models.request.getById',
  'util.models.request.getAncestors',
  'util.models.workspace.getById',
  'util.models.oAuth2Token.getByRequestId',
  'util.models.cookieJar.getOrCreateForWorkspace',
  'util.models.response.getLatestForRequestId',
  'util.models.response.getBodyBuffer',
] as const;

// the request and response a hook's context works on, for a sandboxed plugin to have as data
export const REQUEST_DATA = Symbol.for('insomnium.plugin.request');
export const RESPONSE_DATA = Symbol.for('insomnium.plugin.response');

// a value as it can cross a MessagePort: functions and symbols dropped, a
// repeated object once, bytes as bytes
export function cloneable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer || value instanceof Date || value instanceof RegExp) {
    return value;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => cloneable(item, seen) ?? null);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const copy = cloneable(item, seen);
    if (copy !== undefined) {
      out[key] = copy;
    }
  }
  return out;
}

export const serializeError = (err: unknown): SerializedError => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack, nodeModule: (err as { nodeModule?: string }).nodeModule };
  }
  return { name: 'Error', message: String(err) };
};
