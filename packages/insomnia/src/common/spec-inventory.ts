// A design document's spec against its collection's requests (OWASP API9:2023,
// Improper Inventory Management): the requests the spec doesn't describe, and
// the operations no request covers. An endpoint that isn't in the spec isn't
// reviewed with it, and an operation without a request isn't tested by the
// security checks. Nothing is sent to find either: it's the two lists compared.
import YAML from 'yaml';

import type { AuditFinding } from './response-audit';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export interface SpecOperation {
  method: string;
  // as the spec has it: /orders/{id}
  path: string;
}

export interface InventoryRequest {
  requestId: string;
  method: string;
  // as the request has it: template tags and all
  url: string;
}

export interface SpecInventory {
  // how many operations the spec has
  operations: number;
  // the operations no request covers: "GET /orders/{id}"
  uncovered: string[];
  // the requests the spec doesn't describe, each with what it asks for
  undocumented: { requestId: string; operation: string }[];
}

// a spec's operations and the paths its servers put them under; null for
// what isn't an OpenAPI or Swagger document with paths
export const specOperations = (contents: string): { operations: SpecOperation[]; basePaths: string[] } | null => {
  let spec: any;
  try {
    spec = YAML.parse(contents);
  } catch {
    return null;
  }
  if (!spec || typeof spec !== 'object' || !spec.paths || typeof spec.paths !== 'object' || !(spec.openapi || spec.swagger)) {
    return null;
  }
  const operations: SpecOperation[] = [];
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    if (item && typeof item === 'object') {
      METHODS.filter(method => item[method] && typeof item[method] === 'object').forEach(method => operations.push({ method: method.toUpperCase(), path }));
    }
  }
  // OpenAPI 3's servers, Swagger 2's basePath: where the paths start
  const urls: string[] = Array.isArray(spec.servers) ? spec.servers.map((server: any) => String(server?.url || '')) : [];
  const basePaths = [...urls.map(url => url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')), typeof spec.basePath === 'string' ? spec.basePath : '']
    .map(base => base.replace(/\/+$/, ''))
    .filter(Boolean);
  return { operations, basePaths: [...new Set(basePaths)] };
};

// a path's parts; null for one that stands for anything (a variable)
const WILDCARD = /^(\{[^{}]+\}|:[\w-]+)$|\{\{|\{%/;
const segments = (path: string) => path.split('/').filter(Boolean).map(segment => WILDCARD.test(segment) ? null : segment);

// the path of a request's URL, as written: without its scheme and host, or the
// variable that stands for them ({{ base_url }}/orders), its query and its hash
export const requestPath = (url: string) => {
  let rest = url.trim().split(/[?#]/)[0];
  const host = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(rest);
  if (host) {
    rest = rest.slice(host[0].length);
  } else {
    // (leading template tags, up to the first slash after them; one may stand
    // for the scheme alone, with the host after it)
    const tag = /^(\{\{.*?\}\}|\{%.*?%\})+(:\/\/[^/]*)?[^/]*/.exec(rest);
    rest = tag ? rest.slice(tag[0].length) : rest.replace(/^[^/]*/, '');
  }
  return rest || '/';
};

const same = (request: (string | null)[], template: (string | null)[]) =>
  request.length === template.length && request.every((part, index) => part === null || template[index] === null || part === template[index]);

// The operations that describe a request's path: as it is or under one of the
// spec's base paths; failing those, under a prefix the spec doesn't name, such
// as a gateway's, where the path's end is the operation's. Of those, only the
// longest: a variable at a path's end stands for anything, so /api/orders/{{id}}
// ends like /orders/{id} and like /health too, and it's the first it means
const operationsFor = (method: string, path: string, { operations, basePaths }: { operations: SpecOperation[]; basePaths: string[] }) => {
  const request = segments(path);
  const candidates = operations.filter(operation => operation.method === method.toUpperCase());
  const direct = candidates.filter(operation => {
    const template = segments(operation.path);
    return same(request, template) || basePaths.some(base => {
      const prefix = segments(base);
      return request.length === prefix.length + template.length && same(request.slice(0, prefix.length), prefix) && same(request.slice(prefix.length), template);
    });
  });
  if (direct.length) {
    return direct;
  }
  const behind = candidates
    .map(operation => ({ operation, template: segments(operation.path) }))
    .filter(({ template }) => template.length > 0 && request.length > template.length && same(request.slice(request.length - template.length), template));
  const longest = Math.max(0, ...behind.map(({ template }) => template.length));
  return behind.filter(({ template }) => template.length === longest).map(({ operation }) => operation);
};

export const compareWithSpec = (contents: string, requests: InventoryRequest[]): SpecInventory | null => {
  const spec = specOperations(contents);
  if (!spec) {
    return null;
  }
  const covered = new Set<SpecOperation>();
  const undocumented: SpecInventory['undocumented'] = [];
  for (const { requestId, method, url } of requests) {
    const path = requestPath(url);
    const found = operationsFor(method, path, spec);
    found.forEach(operation => covered.add(operation));
    if (!found.length) {
      undocumented.push({ requestId, operation: `${method.toUpperCase()} ${path}` });
    }
  }
  return {
    operations: spec.operations.length,
    uncovered: spec.operations.filter(operation => !covered.has(operation)).map(({ method, path }) => `${method} ${path}`),
    undocumented,
  };
};

// One request against the spec: the operations that describe it ("GET
// /orders/{id}"), or what it asks for when none does. null for what isn't a
// spec with paths
export const requestAgainstSpec = (contents: string, { method, url }: Pick<InventoryRequest, 'method' | 'url'>): { described: string[]; operation: string } | null => {
  const spec = specOperations(contents);
  if (!spec) {
    return null;
  }
  const path = requestPath(url);
  return {
    described: operationsFor(method, path, spec).map(operation => `${operation.method} ${operation.path}`),
    operation: `${method.toUpperCase()} ${path}`,
  };
};

// what a request the spec doesn't describe is reported as
export const notInSpecFinding = (operation: string): AuditFinding => ({
  id: 'not-in-spec',
  severity: 'low',
  owasp: 'API9:2023 Improper Inventory Management',
  title: "A request the spec doesn't describe",
  detail: "An endpoint that isn't in the spec isn't reviewed, documented or linted with the rest. Add it to the spec, or retire it if it's left over from an older version.",
  evidence: operation,
});
