/**
 * @jest-environment node
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { CaptureProxy, MAX_BODY } from '../capture-proxy';

// a request through the proxy, as an app with HTTP_PROXY set sends it
const viaProxy = (proxyPort: number, url: string, method = 'GET', body?: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: proxyPort, method, path: url, headers }, response => {
      let text = '';
      response.on('data', chunk => (text += chunk));
      response.on('end', () => resolve({ status: response.statusCode || 0, body: text }));
    });
    request.on('error', reject);
    request.end(body);
  });

describe('CaptureProxy', () => {
  let target: http.Server;
  let targetPort: number;
  let echo: net.Server;
  let echoPort: number;
  let proxy: CaptureProxy;
  let proxyPort: number;

  beforeAll(async () => {
    target = http.createServer((request, response) => {
      let body = '';
      request.on('data', chunk => (body += chunk));
      request.on('end', () => {
        response.writeHead(201, { 'Content-Type': 'application/json', 'X-Seen-Proxy-Auth': String(!!request.headers['proxy-authorization']) });
        response.end(JSON.stringify({ path: request.url, body, big: request.url === '/big' ? 'x'.repeat(MAX_BODY + 10) : undefined }));
      });
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    targetPort = (target.address() as AddressInfo).port;
    echo = net.createServer(socket => socket.pipe(socket));
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve));
    echoPort = (echo.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise(resolve => target.close(resolve));
    await new Promise(resolve => echo.close(resolve));
  });

  beforeEach(async () => {
    proxy = new CaptureProxy();
    proxyPort = (await proxy.start(0))!;
  });
  afterEach(() => proxy.stop());

  it('passes a plain HTTP request on, and records it and its response', async () => {
    const answer = await viaProxy(proxyPort, `http://127.0.0.1:${targetPort}/orders?open=1`, 'POST', '{"sku":"A-1"}', { 'Content-Type': 'application/json', 'Proxy-Authorization': 'Basic eDp5' });

    expect(answer).toEqual({ status: 201, body: '{"path":"/orders?open=1","body":"{\\"sku\\":\\"A-1\\"}"}' });
    const [exchange] = proxy.exchanges;
    expect(exchange).toMatchObject({
      method: 'POST',
      url: `http://127.0.0.1:${targetPort}/orders?open=1`,
      requestBody: '{"sku":"A-1"}',
      statusCode: 201,
      responseBody: answer.body,
      truncated: false,
    });
    expect(exchange.requestHeaders).toContainEqual({ name: 'Content-Type', value: 'application/json' });
    // the proxy's own headers aren't sent on, or kept
    expect(exchange.requestHeaders.map(({ name }) => name.toLowerCase())).not.toContain('proxy-authorization');
    expect(exchange.responseHeaders).toContainEqual({ name: 'X-Seen-Proxy-Auth', value: 'false' });
    expect(exchange.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps bodies up to 1 MB, and says when it cut one', async () => {
    const answer = await viaProxy(proxyPort, `http://127.0.0.1:${targetPort}/big`);

    expect(answer.body.length).toBeGreaterThan(MAX_BODY);
    expect(proxy.exchanges[0].responseBody.length).toBe(MAX_BODY);
    expect(proxy.exchanges[0].truncated).toBe(true);
  });

  it('lets the oldest bodies go past its budget, and lists without bodies', async () => {
    await proxy.stop();
    // room for one exchange: its request and its echoed response
    proxy = new CaptureProxy(() => {}, 200);
    proxyPort = (await proxy.start(0))!;
    await viaProxy(proxyPort, `http://127.0.0.1:${targetPort}/first`, 'POST', 'a'.repeat(60));
    await viaProxy(proxyPort, `http://127.0.0.1:${targetPort}/second`, 'POST', 'b'.repeat(60));

    const [first, second] = proxy.exchanges;
    expect(first).toMatchObject({ requestBody: '', responseBody: '', truncated: true });
    expect(second.requestBody).toBe('b'.repeat(60));
    expect(proxy.summaries().every(exchange => exchange.requestBody === '' && exchange.responseBody === '')).toBe(true);
    expect(proxy.get(second.id)?.requestBody).toBe('b'.repeat(60));
  });

  it('tunnels CONNECT without reading it, and lists it by host', async () => {
    const socket = net.connect(proxyPort, '127.0.0.1');
    let received = '';
    socket.on('data', chunk => (received += chunk));
    socket.write(`CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\n\r\n`);
    await new Promise(resolve => setTimeout(resolve, 100));
    socket.write('ping');
    await new Promise(resolve => setTimeout(resolve, 100));
    socket.destroy();

    expect(received).toBe('HTTP/1.1 200 Connection Established\r\n\r\nping');
    expect(proxy.exchanges[0]).toMatchObject({ method: 'CONNECT', tunnel: `127.0.0.1:${echoPort}`, statusCode: 200, requestBody: '', responseBody: '' });
  });

  it("turns away what isn't a proxy request, and requests to itself", async () => {
    expect((await viaProxy(proxyPort, '/just-a-path')).status).toBe(400);
    expect((await viaProxy(proxyPort, `http://127.0.0.1:${proxyPort}/loop`)).status).toBe(508);
    expect(proxy.exchanges).toEqual([]);
  });

  it('says why a request couldn\'t be sent on', async () => {
    const closed = net.createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise(resolve => closed.close(resolve));

    expect((await viaProxy(proxyPort, `http://127.0.0.1:${port}/`)).status).toBe(502);
    expect(proxy.exchanges[0].error).toContain('ECONNREFUSED');
  });
});
