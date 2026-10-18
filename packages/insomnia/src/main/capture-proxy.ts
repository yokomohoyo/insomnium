// Capture: a proxy on this computer that records the requests sent through
// it, to keep as requests in a collection. Point an app, a script or a browser
// at it (HTTP_PROXY=http://127.0.0.1:8899). Plain HTTP is recorded in full:
// method, URL, headers and body, and the response's status, headers and body.
// HTTPS goes through its CONNECT tunnel untouched and is listed by host only:
// reading it would mean trusting a certificate authority of Insomnium's, and a
// privacy tool shouldn't ask that. A browser's devtools can save HTTPS traffic
// as a HAR file, which Import takes.
import http from 'node:http';
import net from 'node:net';

import { BrowserWindow, ipcMain } from 'electron';

export interface CapturedExchange {
  id: number;
  startedAt: number;
  method: string;
  url: string;
  // for CONNECT: the host and port tunnelled to
  tunnel?: string;
  requestHeaders: { name: string; value: string }[];
  requestBody: string;
  statusCode?: number;
  statusMessage?: string;
  responseHeaders: { name: string; value: string }[];
  responseBody: string;
  // the bodies were longer than kept
  truncated: boolean;
  elapsedMs?: number;
  error?: string;
}

export const MAX_EXCHANGES = 500;
export const MAX_BODY = 1024 * 1024;
// sent on by the proxy, not by what's captured
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

const headerList = (raw: string[]) => {
  const headers: { name: string; value: string }[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    headers.push({ name: raw[index], value: raw[index + 1] });
  }
  return headers;
};

// a body as text, kept up to MAX_BODY
const collector = () => {
  const chunks: Buffer[] = [];
  let length = 0;
  let truncated = false;
  return {
    add(chunk: Buffer) {
      if (length < MAX_BODY) {
        chunks.push(chunk.subarray(0, MAX_BODY - length));
      }
      length += chunk.length;
      truncated ||= length > MAX_BODY;
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    get truncated() {
      return truncated;
    },
  };
};

export class CaptureProxy {
  exchanges: CapturedExchange[] = [];
  private server?: http.Server;
  private nextId = 1;
  private sockets = new Set<net.Socket>();

  constructor(private readonly onChange: () => void = () => {}) {}

  get port() {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  private record(exchange: CapturedExchange) {
    this.exchanges.push(exchange);
    if (this.exchanges.length > MAX_EXCHANGES) {
      this.exchanges.shift();
    }
    this.onChange();
    return exchange;
  }

  async start(port: number) {
    if (this.server) {
      return this.port;
    }
    const server = http.createServer((request, response) => this.forward(request, response));
    server.on('connect', (request, socket: net.Socket, head) => this.tunnel(request, socket, head));
    server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // this computer only
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    return this.port;
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    if (!server) {
      return;
    }
    this.sockets.forEach(socket => socket.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  clear() {
    this.exchanges = [];
    this.onChange();
  }

  // a plain HTTP request, sent as a proxy request (GET http://host/path)
  private forward(request: http.IncomingMessage, response: http.ServerResponse) {
    const started = Date.now();
    let target: URL;
    try {
      target = new URL(request.url || '');
      if (target.protocol !== 'http:') {
        throw new Error('not http');
      }
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Insomnium\'s capture is a proxy: send requests through it with their full URL (set it as your HTTP proxy).\n');
      return;
    }
    // a request to the proxy itself would loop
    if (['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && Number(target.port || 80) === this.port) {
      response.writeHead(508, { 'Content-Type': 'text/plain' });
      response.end('That is the capture proxy itself.\n');
      return;
    }
    const requestBody = collector();
    const responseBody = collector();
    const exchange = this.record({
      id: this.nextId++,
      startedAt: started,
      method: request.method || 'GET',
      url: target.toString(),
      requestHeaders: headerList(request.rawHeaders).filter(({ name }) => !HOP_BY_HOP.has(name.toLowerCase())),
      requestBody: '',
      responseHeaders: [],
      responseBody: '',
      truncated: false,
    });
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
    const upstream = http.request({
      host: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || 80,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
    }, upstreamResponse => {
      exchange.statusCode = upstreamResponse.statusCode;
      exchange.statusMessage = upstreamResponse.statusMessage;
      exchange.responseHeaders = headerList(upstreamResponse.rawHeaders).filter(({ name }) => !HOP_BY_HOP.has(name.toLowerCase()));
      const responseHeaders = Object.fromEntries(Object.entries(upstreamResponse.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage, responseHeaders as http.OutgoingHttpHeaders);
      upstreamResponse.on('data', (chunk: Buffer) => {
        responseBody.add(chunk);
        response.write(chunk);
      });
      upstreamResponse.on('end', () => {
        response.end();
        exchange.responseBody = responseBody.text();
        exchange.truncated = requestBody.truncated || responseBody.truncated;
        exchange.elapsedMs = Date.now() - started;
        this.onChange();
      });
    });
    upstream.on('error', err => {
      exchange.error = err.message;
      exchange.elapsedMs = Date.now() - started;
      this.onChange();
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      response.end(`Insomnium's capture couldn't reach ${target.host}: ${err.message}\n`);
    });
    request.on('data', (chunk: Buffer) => {
      requestBody.add(chunk);
      upstream.write(chunk);
    });
    request.on('end', () => {
      exchange.requestBody = requestBody.text();
      upstream.end();
    });
  }

  // HTTPS (and anything else) through CONNECT: tunnelled, not read
  private tunnel(request: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const [host, portText] = (request.url || '').split(/:(?=\d+$)/);
    const port = Number(portText || 443);
    const exchange = this.record({
      id: this.nextId++,
      startedAt: Date.now(),
      method: 'CONNECT',
      url: `https://${host}${port === 443 ? '' : `:${port}`}`,
      tunnel: `${host}:${port}`,
      requestHeaders: [],
      requestBody: '',
      responseHeaders: [],
      responseBody: '',
      truncated: false,
    });
    const upstream = net.connect(port, host.replace(/^\[|\]$/g, ''), () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      exchange.statusCode = 200;
      this.onChange();
      if (head.length) {
        upstream.write(head);
      }
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', err => {
      exchange.error = err.message;
      this.onChange();
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => {
      exchange.elapsedMs = Date.now() - exchange.startedAt;
      upstream.destroy();
    });
  }
}

let proxy: CaptureProxy | undefined;
const broadcast = () => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('capture.changed');
  }
};

export interface CaptureBridgeAPI {
  start: (options: { port: number }) => Promise<number | null>;
  stop: () => Promise<void>;
  status: () => Promise<number | null>;
  list: () => Promise<CapturedExchange[]>;
  clear: () => Promise<void>;
}

export function registerCaptureHandlers() {
  ipcMain.handle('capture.start', async (_, { port }: { port: number }) => {
    proxy ??= new CaptureProxy(broadcast);
    return proxy.start(port);
  });
  ipcMain.handle('capture.stop', () => proxy?.stop());
  ipcMain.handle('capture.status', () => proxy?.port ?? null);
  ipcMain.handle('capture.list', () => proxy?.exchanges ?? []);
  ipcMain.handle('capture.clear', () => proxy?.clear());
}
