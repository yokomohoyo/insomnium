// Runs against the build: `npm test` compiles first.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

import {
  authHeaders,
  DiscoveryError,
  discoveryFilePath,
  endpointUrl,
  isLoopbackHost,
  readDiscovery,
} from '../dist/discovery.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'insomnium-discovery-'));
const file = path.join(dir, 'mcp.json');
const saved = process.env.INSOMNIUM_MCP_DISCOVERY_FILE;

beforeEach(() => {
  process.env.INSOMNIUM_MCP_DISCOVERY_FILE = file;
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) {
    delete process.env.INSOMNIUM_MCP_DISCOVERY_FILE;
  } else {
    process.env.INSOMNIUM_MCP_DISCOVERY_FILE = saved;
  }
});

const write = value => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));

const rejects = (message) => assert.rejects(readDiscovery(), err => {
  assert.ok(err instanceof DiscoveryError);
  assert.equal(err.message, message);
  return true;
});

test('discoveryFilePath: the override, else ~/.insomnium/mcp.json', () => {
  assert.equal(discoveryFilePath(), file);
  delete process.env.INSOMNIUM_MCP_DISCOVERY_FILE;
  assert.equal(discoveryFilePath(), path.join(os.homedir(), '.insomnium', 'mcp.json'));
});

test('readDiscovery: a missing file', async () => {
  process.env.INSOMNIUM_MCP_DISCOVERY_FILE = path.join(dir, 'none.json');
  await rejects(
    `could not read ${path.join(dir, 'none.json')}. Is Insomnium running with the MCP automation `
    + 'server enabled? (Settings → MCP automation)',
  );
});

test('readDiscovery: not JSON', async () => {
  write('{nope');
  await rejects(`discovery file ${file} is not valid JSON`);
});

test('readDiscovery: missing port or token', async () => {
  write({ port: 1234 });
  await rejects(`discovery file ${file} is missing port/token`);
  write({ token: 't' });
  await rejects(`discovery file ${file} is missing port/token`);
});

test('readDiscovery: a port that is not an integer from 1 to 65535', async () => {
  for (const port of [1.5, -1, 65536, '8080']) {
    write({ port, token: 't' });
    await rejects(`discovery file ${file} has an invalid port: ${port}`);
  }
});

test('readDiscovery: a url that does not parse', async () => {
  write({ port: 1234, token: 't', url: 'not a url' });
  await rejects(`discovery file ${file} has an invalid url: not a url`);
});

test('readDiscovery: a url that leaves this computer', async () => {
  for (const [url, host] of [
    ['http://example.com:1234/sse', 'example.com'],
    ['http://127.0.0.1.example.com/sse', '127.0.0.1.example.com'],
    ['http://localhost.example.com/sse', 'localhost.example.com'],
    ['http://[::2]:1234/sse', '[::2]'],
    ['http://192.168.1.10:1234/sse', '192.168.1.10'],
  ]) {
    write({ port: 1234, token: 't', url });
    await rejects(`discovery file ${file} url must target loopback, got host: ${host}`);
  }
});

test('readDiscovery: loopback urls and no url', async () => {
  for (const url of [
    undefined,
    'http://127.0.0.1:1234/sse',
    'http://127.9.8.7:1234/sse',
    'http://LOCALHOST:1234/sse',
    'http://[::1]:1234/sse',
  ]) {
    const disc = { port: 1234, token: 't', ...(url ? { url } : {}) };
    write(disc);
    assert.deepEqual(await readDiscovery(), disc);
  }
});

test('isLoopbackHost: hostnames as URL.hostname gives them', () => {
  for (const host of ['localhost', 'LocalHost', '[::1]', '127.0.0.1', '127.255.255.254']) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ['', '::1', '0.0.0.0', '128.0.0.1', '127.0.0.1.evil.test', 'localhost.evil.test']) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test('endpointUrl: the url in the file, else the port on 127.0.0.1', () => {
  assert.equal(endpointUrl({ port: 1234, token: 't' }), 'http://127.0.0.1:1234/sse');
  assert.equal(endpointUrl({ port: 1234, token: 't', url: 'http://localhost:9/x' }), 'http://localhost:9/x');
});

test('authHeaders: the bearer token', () => {
  assert.deepEqual(authHeaders({ port: 1234, token: 'abc' }), { Authorization: 'Bearer abc' });
});
