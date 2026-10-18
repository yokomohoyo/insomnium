/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { _clearSecretCache, readAwsSecret, readAzureSecret, readGcpSecret, readOnePasswordSecret, readVaultSecret } from '../secret-managers';

// a stand-in for a secret manager's API, recording what it was asked
let server: http.Server;
let url: string;
let asked: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[];
let answer: (req: http.IncomingMessage, body: string) => [number, unknown];

beforeEach(async () => {
  _clearSecretCache();
  asked = [];
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      asked.push({ method: req.method, url: req.url, headers: req.headers, body });
      const [status, json] = answer(req, body);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => new Promise(resolve => server.close(resolve)));

describe('the secret tags', () => {
  it('read only the secrets Preferences allow', async () => {
    await expect(readVaultSecret('secret/data/app', 'password', '')).rejects.toThrow("vault:secret/data/app isn't an allowed secret: add it, or a prefix of it ending in *, in Preferences > General > Secrets");
    await expect(readOnePasswordSecret('op://Work/db/password', 'op://Home/*')).rejects.toThrow("op://Work/db/password isn't an allowed secret");
    await expect(readAwsSecret('prod/key', '', 'eu-west-1', 'aws:staging/*')).rejects.toThrow("aws:prod/key isn't an allowed secret");
    await expect(readGcpSecret('projects/p/secrets/key', '', '')).rejects.toThrow("gcp:projects/p/secrets/key isn't an allowed secret");
    await expect(readAzureSecret('vault', 'key', '', 'azure:other/*')).rejects.toThrow("azure:vault/key isn't an allowed secret");
    expect(asked).toEqual([]);
  });

  it('read a field of a Vault KV secret, version 2 or 1, once for a while', async () => {
    answer = req => req.url === '/v1/secret/data/app'
      ? [200, { data: { data: { password: 's3cret', port: 5432 }, metadata: { version: 3 } } }]
      : [200, { data: { password: 'v1-secret' } }];
    const env = { VAULT_ADDR: `${url}/`, VAULT_TOKEN: 'hvs.test' };
    expect(await readVaultSecret('secret/data/app', 'password', 'vault:secret/*', env)).toBe('s3cret');
    expect(await readVaultSecret('secret/data/app', 'port', 'vault:secret/*', env)).toBe('5432');
    expect(await readVaultSecret('/kv/app', 'password', 'vault:kv/app', env)).toBe('v1-secret');
    expect(asked.map(({ url, headers }) => [url, headers['x-vault-token']])).toEqual([['/v1/secret/data/app', 'hvs.test'], ['/v1/kv/app', 'hvs.test']]);
    await expect(readVaultSecret('secret/data/app', 'missing', 'vault:secret/*', env)).rejects.toThrow('vault:secret/data/app has no field missing');
    await expect(readVaultSecret('secret/data/app', 'password', 'vault:secret/*', { VAULT_TOKEN: 'x' })).rejects.toThrow('Set VAULT_ADDR');
  });

  it('read an AWS secret, signed, and a field of a JSON one', async () => {
    answer = (_req, body) => [200, { Name: JSON.parse(body).SecretId, SecretString: '{"user":"app","password":"aws-secret"}' }];
    const env = { AWS_ENDPOINT_URL_SECRETS_MANAGER: url, AWS_ACCESS_KEY_ID: 'AKIATEST', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'eu-west-1' };
    expect(await readAwsSecret('prod/db', 'password', '', 'aws:prod/*', env)).toBe('aws-secret');
    expect(await readAwsSecret('prod/db', '', '', 'aws:prod/*', env)).toBe('{"user":"app","password":"aws-secret"}');
    expect(asked).toHaveLength(1);
    expect(asked[0].headers['x-amz-target']).toBe('secretsmanager.GetSecretValue');
    expect(asked[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/eu-west-1\/secretsmanager\/aws4_request/);
    await expect(readAwsSecret('prod/db', '', '', 'aws:prod/*', { AWS_REGION: 'eu-west-1' })).rejects.toThrow('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  });

  it("say what's wrong with a reference, or a missing CLI", async () => {
    await expect(readOnePasswordSecret('Work/db/password', '*')).rejects.toThrow("isn't a 1Password secret reference: op://vault/item/field");
    await expect(readGcpSecret('my-secret', '', '*')).rejects.toThrow("my-secret isn't a secret name: projects/<project>/secrets/<secret>");
    await expect(readAzureSecret('', 'key', '', '*')).rejects.toThrow('Give the key vault and secret names');
    // CI has no op CLI
    await expect(readOnePasswordSecret('op://Work/db/password', 'op://Work/*')).rejects.toThrow(/op/);
  });
});
