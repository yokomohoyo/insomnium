import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { getRenderContext, KEEP_ON_ERROR, render } from '../common/render';
import * as models from '../models';
import type { Request } from '../models/request';
import { chooseExample, loadMockRoutes, type MockLogEntry, type MockRoute, matchRoute } from './mock-routes';

// A local mock server: it answers as a collection's requests would, with
// their saved examples (models/response-example.ts), matched as mock-routes.ts
// says. Tags in an example's body ({{ }} and {% %}, such as faker) are
// rendered with the collection's base environment on each answer. It listens
// on 127.0.0.1 by default.
//
// Examples saved from real responses can hold real data, so other websites in
// the browser mustn't read them: CORS is allowed only to pages on this
// computer (localhost, any port), and on a loopback address a request must
// name a loopback host, so a DNS-rebinding page can't reach it either.

// headers that would describe the original transfer rather than this one
const SKIPPED_HEADERS = new Set(['content-length', 'transfer-encoding', 'content-encoding', 'connection', 'keep-alive', 'set-cookie']);

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

// CORS headers for a page on this computer, and none for anything else
const corsHeaders = (origin: string | undefined): Record<string, string> => origin && LOCAL_ORIGIN.test(origin) ? {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  Vary: 'Origin',
} : { Vary: 'Origin' };

// the host a request names, without its port
const hostnameOf = (host = '') => host.replace(/:\d+$/, '');

export interface MockServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export interface MockServerOptions {
  // the collections it answers for
  workspaceIds: string[];
  port?: number;
  host?: string;
  onRequest?: (entry: MockLogEntry) => void;
}

// the body, with its tags rendered; as written if they can't be
const renderedBody = async (route: MockRoute, body: string) => {
  if (!/{{|{%/.test(body)) {
    return body;
  }
  try {
    const context = await getRenderContext({ request: route.request as Request });
    return String(await render(body, context, null, KEEP_ON_ERROR));
  } catch (err) {
    return body;
  }
};

export async function startMockServer({ workspaceIds, port = 0, host = '127.0.0.1', onRequest }: MockServerOptions): Promise<MockServer> {
  const loopback = LOOPBACK.test(host);
  const server = http.createServer(async (req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    const path = (req.url || '/').split('?')[0];
    const log = (entry: Omit<MockLogEntry, 'time' | 'method' | 'path'>) => onRequest?.({ time: Date.now(), method, path, ...entry });
    const CORS_HEADERS = corsHeaders(req.headers.origin);
    if (loopback && !LOOPBACK.test(hostnameOf(req.headers.host))) {
      res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Insomnium mock: answers only requests for localhost' }));
      log({ status: 403, note: `refused the host ${req.headers.host || '(none)'}` });
      return;
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS).end();
      log({ status: 204, note: 'CORS preflight' });
      return;
    }
    try {
      // read each time, so edits to the examples answer straight away
      const routes: MockRoute[] = [];
      for (const workspaceId of workspaceIds) {
        const workspace = await models.workspace.getById(workspaceId);
        routes.push(...(workspace ? await loadMockRoutes(workspace) : []));
      }
      const route = matchRoute(routes, method, path);
      const example = route && chooseExample(route.examples, req.headers);
      if (!route || !example) {
        const note = route ? 'no example matches the x-mock-response headers' : 'no request with an example matches';
        res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS }).end(JSON.stringify({ error: `Insomnium mock: ${note}`, method, path }));
        log({ status: 404, requestName: route?.request.name, note });
        return;
      }
      const headers: Record<string, string> = { ...CORS_HEADERS };
      for (const { name, value } of example.headers) {
        if (name && !SKIPPED_HEADERS.has(name.toLowerCase())) {
          headers[name] = value;
        }
      }
      const body = method === 'HEAD' ? undefined : await renderedBody(route, example.body);
      res.writeHead(example.statusCode || 200, example.statusMessage || undefined, headers).end(body);
      log({ status: example.statusCode || 200, requestName: route.request.name, exampleName: example.name });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS }).end(JSON.stringify({ error: `Insomnium mock: ${(err as Error).message}` }));
      log({ status: 500, note: (err as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const { port: bound } = server.address() as AddressInfo;
  return {
    port: bound,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${bound}`,
    close: () => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
