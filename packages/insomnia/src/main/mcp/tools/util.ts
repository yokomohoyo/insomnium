import * as models from '../../../models';
import type { BaseModel } from '../../../models';
import { isGrpcRequest } from '../../../models/grpc-request';
import { isMcpRequest } from '../../../models/mcp-request';
import { isEventStreamRequest, isRequest } from '../../../models/request';
import { isWebSocketRequest } from '../../../models/websocket-request';
import type { Workspace } from '../../../models/workspace';
import { isMetadataHost } from '../../../network/metadata-hosts';
import { checkRequestPolicy } from '../../../network/request-policy';

// A request's type as the tools name it: an Event Stream is an HTTP request
// that accepts text/event-stream
export const requestTypeLabel = (req: Pick<BaseModel, 'type'>) =>
  isGrpcRequest(req) ? 'gRPC'
    : isWebSocketRequest(req) ? 'WebSocket'
      : isMcpRequest(req) ? 'MCP'
        : isEventStreamRequest(req) ? 'Event Stream'
          : isRequest(req) ? 'HTTP' : 'unknown';

// Re-exported from the network layer so gRPC metadata can reuse it.
export { assertSafeHeaders } from '../../../network/header-injection';

// Restrict an LLM-driven request URL to http(s) (or the schemes given, ws(s)
// for a WebSocket) and block cloud-metadata hosts. Loopback/private hosts stay
// allowed (local dev). Throws if disallowed.
export function assertSafeRequestUrl(rawUrl: string, schemes: string[] = ['http:', 'https:']): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Refusing to send: '${rawUrl}' is not a valid absolute URL.`);
  }
  if (!schemes.includes(parsed.protocol)) {
    throw new Error(`Refusing to send: scheme '${parsed.protocol}' is not allowed (only ${schemes.map(scheme => scheme.slice(0, -1)).join(' and ')}).`);
  }
  if (isMetadataHost(parsed.hostname)) {
    throw new Error(`Refusing to send: '${parsed.hostname}' is a cloud-metadata endpoint and is blocked.`);
  }
  checkRequestPolicy(rawUrl);
}

// Normalized field names masked anywhere they appear (lowercased, separators stripped).
const SECRET_KEYS = new Set([
  'password', 'passphrase', 'secret', 'clientsecret', 'privatekey', 'privatekeyid',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'apikey', 'sessionid', 'salt',
  'credentials',
]);
// Substrings that always mark a secret (clientSecret, consumerSecret, ...).
const SECRET_SUBSTRINGS = ['secret', 'password', 'passphrase'];
// Secrets too generically named to mask globally, keyed by auth type: apikey's
// is `value` (key = header name), hawk's is `key`, oauth's the transient `code`.
const AUTH_SECRET_FIELDS: Record<string, string[]> = {
  apikey: ['value'],
  hawk: ['key'],
  oauth2: ['code'],
  oauth1: ['code'],
};
const SECRET_HEADER = /^(set-cookie|authorization|proxy-authorization|cookie|x-api-key|x-auth-token|api-key)$/i;
const REDACTED = '***REDACTED***';

function isSecretKey(normalized: string, authFields: string[] | undefined): boolean {
  return SECRET_KEYS.has(normalized)
    || SECRET_SUBSTRINGS.some(s => normalized.includes(s))
    || (authFields ? authFields.includes(normalized) : false);
}

function redactWalk(value: any, seen: WeakSet<object>): any {
  if (Array.isArray(value)) {
    return value.map(v => redactWalk(v, seen));
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) {
      return undefined; // defensive cycle guard
    }
    seen.add(value);
    // Mask a header/param value when its name is sensitive.
    const sensitiveHeader = typeof value.name === 'string' && SECRET_HEADER.test(value.name) && 'value' in value;
    const authFields = typeof value.type === 'string' ? AUTH_SECRET_FIELDS[value.type.toLowerCase()] : undefined;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const normalized = k.replace(/[_-]/g, '').toLowerCase();
      if (k === 'value' && sensitiveHeader && v) {
        out[k] = REDACTED;
      } else if (isSecretKey(normalized, authFields) && v !== null && v !== undefined && v !== '') {
        out[k] = REDACTED; // mask the whole value (incl. nested SA-JSON)
      } else {
        out[k] = redactWalk(v, seen);
      }
    }
    return out;
  }
  return value;
}

// Deep-copy with credential values masked; structure preserved so the model
// sees which fields are set but can't read the secrets back.
export function redactSecrets<T>(value: T): T {
  return redactWalk(value, new WeakSet<object>()) as T;
}

// Walk parentId links up through folders to the owning workspace; cycle-safe.
// An environment a client names for a send: the workspace's base environment
// or one of its sub environments, not another workspace's, whose values would
// go with the request. An error to return, or null when it's one of them.
export async function foreignEnvironment(workspaceId: string | undefined, environmentId: string | null | undefined): Promise<string | null> {
  if (!environmentId) {
    return null;
  }
  const env = await models.environment.getById(environmentId);
  const base = workspaceId ? await models.environment.getOrCreateForParentId(workspaceId) : null;
  return env && base && (env._id === base._id || env.parentId === base._id)
    ? null
    : `environment ${environmentId} does not belong to ${workspaceId ? `workspace ${workspaceId}` : "the request's workspace"}`;
}

export async function findWorkspaceForRequest(parentId: string): Promise<Workspace | null> {
  let cur: string | null = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const workspace = await models.workspace.getById(cur);
    if (workspace) {
      return workspace;
    }
    const group = await models.requestGroup.getById(cur);
    cur = group ? group.parentId : null;
  }
  return null;
}
