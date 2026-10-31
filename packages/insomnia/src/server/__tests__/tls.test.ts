import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { parseConfig } from '../config';
import { parseTeamConfig } from '../team';
import { createListener, parseTls } from '../tls';

describe('parseTls()', () => {
  it('takes both files, or neither', () => {
    expect(parseTls({})).toBeUndefined();
    expect(parseTls({ INSOMNIUM_TLS_CERT: '', INSOMNIUM_TLS_KEY: ' ' })).toBeUndefined();
    expect(parseTls({ INSOMNIUM_TLS_CERT: '/certs/a.pem', INSOMNIUM_TLS_KEY: '/certs/a.key' })).toEqual({ cert: '/certs/a.pem', key: '/certs/a.key' });
    expect(() => parseTls({ INSOMNIUM_TLS_CERT: '/certs/a.pem' })).toThrow('Set both INSOMNIUM_TLS_CERT and INSOMNIUM_TLS_KEY');
    expect(() => parseTls({ INSOMNIUM_TLS_KEY: '/certs/a.key' })).toThrow('Set both');
  });

  it('is read by both servers', () => {
    const tls = { INSOMNIUM_TLS_CERT: '/certs/a.pem', INSOMNIUM_TLS_KEY: '/certs/a.key' };
    expect(parseTeamConfig([], tls).tls).toEqual({ cert: '/certs/a.pem', key: '/certs/a.key' });
    expect(parseConfig(['--collection', 'a.yaml'], { ...tls, INSOMNIUM_MCP_TOKEN: 'x'.repeat(32), INSOMNIUM_ALLOWED_HOSTS: '*' }).tls).toEqual({ cert: '/certs/a.pem', key: '/certs/a.key' });
  });
});

// a self-signed certificate for localhost, made for the test
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-tls-'));
const files = { cert: path.join(dir, 'cert.pem'), key: path.join(dir, 'key.pem') };
const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', files.key, '-out', files.cert], { stdio: 'ignore' }).status === 0;

(made ? describe : describe.skip)('createListener()', () => {
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  let port = 0;
  const server = createListener((_req, res) => res.end('over https'), files);
  beforeAll(() => new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => {
    port = (server.address() as { port: number }).port;
    resolve();
  })));
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it('serves HTTPS with the certificate', async () => {
    const body = await new Promise<string>((resolve, reject) => {
      https.get({ host: '127.0.0.1', port, path: '/', ca: fs.readFileSync(files.cert), servername: 'localhost' }, res => {
        let text = '';
        res.on('data', chunk => (text += chunk));
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    expect(body).toBe('over https');
  });

  it("refuses files it can't read", () => {
    expect(() => createListener(() => {}, { cert: path.join(dir, 'missing.pem'), key: files.key })).toThrow("Couldn't read the TLS certificate or key");
  });
});
