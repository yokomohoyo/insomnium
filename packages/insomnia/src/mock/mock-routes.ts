import type { IncomingHttpHeaders } from 'node:http';

import { database as db } from '../common/database';
import type { Request } from '../models/request';
import { isRequest } from '../models/request';
import type { ResponseExample } from '../models/response-example';
import { isResponseExample } from '../models/response-example';
import type { Workspace } from '../models/workspace';

// What the mock server (mock-server.ts) answers with, and how it picks: a
// request is matched by method and by the path of each saved request's URL,
// in which :params, {{ variables }} and the base URL in front are wildcards.
// Postman's x-mock-response-name and x-mock-response-code headers pick an
// example; otherwise the first 2xx one answers.

export interface MockRoute {
  request: Pick<Request, '_id' | 'name' | 'method' | 'url'>;
  examples: ResponseExample[];
}

export interface MockLogEntry {
  time: number;
  method: string;
  path: string;
  status: number;
  // what answered: the request and example, or why nothing did
  requestName?: string;
  exampleName?: string;
  note?: string;
}

const isTemplate = (segment: string) => segment.startsWith(':') || /{{|{%/.test(segment);

// The path a saved URL is for: what follows its host, or the variable in
// front that holds the base URL
export const mockPathOf = (url: string) => {
  let rest = url.trim()
    .replace(/^({{[^}]*}}|{%[^%]*%})+/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  rest = rest.split('#')[0].split('?')[0];
  return `/${rest.replace(/^\/+/, '')}`;
};

const segmentsOf = (path: string) => path.split('/').filter(Boolean);

// How well a saved path fits the path asked for: null when it doesn't, and
// otherwise the number of literal segments that matched (more wins)
export const pathScore = (template: string, path: string): number | null => {
  const wanted = segmentsOf(template);
  const asked = segmentsOf(path);
  if (wanted.length !== asked.length) {
    return null;
  }
  let literal = 0;
  for (let i = 0; i < wanted.length; i++) {
    if (isTemplate(wanted[i])) {
      continue;
    }
    if (decodeURIComponent(asked[i]) !== wanted[i]) {
      return null;
    }
    literal++;
  }
  return literal;
};

const headerOf = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

// The example to answer with: by name or code if the request asks, else the
// first success, else the first
export const chooseExample = (examples: ResponseExample[], headers: IncomingHttpHeaders) => {
  const name = headerOf(headers, 'x-mock-response-name');
  const code = Number(headerOf(headers, 'x-mock-response-code'));
  if (name) {
    return examples.find(example => example.name === name);
  }
  if (code) {
    return examples.find(example => example.statusCode === code);
  }
  return examples.find(example => example.statusCode >= 200 && example.statusCode < 300) || examples[0];
};

export const matchRoute = (routes: MockRoute[], method: string, path: string) => {
  let best: { route: MockRoute; score: number } | undefined;
  for (const route of routes) {
    if (route.request.method.toUpperCase() !== method.toUpperCase() || !route.examples.length) {
      continue;
    }
    const score = pathScore(mockPathOf(route.request.url), path);
    if (score !== null && (!best || score > best.score)) {
      best = { route, score };
    }
  }
  return best?.route;
};

// A collection's HTTP requests that have examples
export async function loadMockRoutes(workspace: Workspace): Promise<MockRoute[]> {
  const docs = await db.withDescendants(workspace);
  const examples = docs.filter(isResponseExample);
  return docs.filter(isRequest).map(request => ({
    request,
    examples: examples.filter(example => example.parentId === request._id).sort((a, b) => a.metaSortKey - b.metaSortKey),
  })).filter(route => route.examples.length);
}
