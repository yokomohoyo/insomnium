import aws4 from 'aws4';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { env as processEnv } from 'node:process';

import { getGcpAccessToken } from '../network/gcp-id-token/get-token';
import { guard } from '../utils/guard';
import { allowedNames, isAllowed } from './os-environment';

// Template tags that read a secret from a secret manager: HashiCorp Vault,
// 1Password, AWS Secrets Manager, Google Cloud Secret Manager and Azure Key
// Vault, each with the credentials already on this computer (a token in the
// environment, a signed-in CLI, the cloud SDK's default credentials).
//
// A collection from someone else could put any of these into a request to
// anywhere, so a tag reads only the secrets Preferences allow, by reference,
// as {% env %} reads only the variables allowed. None are allowed until listed.
// A secret is kept in memory for a few minutes, so the tag preview, which
// renders as you type, doesn't ask the secret manager each time.

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: Promise<string>; expires: number }>();

export const _clearSecretCache = () => cache.clear();

const cached = (key: string, read: () => Promise<string>) => {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value;
  }
  const value = read();
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  // a failure is asked again next time
  value.catch(() => cache.delete(key));
  return value;
};

export const assertSecretAllowed = (reference: string, allowedSecrets = '') => guard(
  isAllowed(reference, allowedNames(allowedSecrets)),
  `${reference} isn't an allowed secret: add it, or a prefix of it ending in *, in Preferences > General > Secrets`,
);

// A JSON secret's field, or the whole secret
const pick = (secret: string, field: string, reference: string) => {
  if (!field) {
    return secret;
  }
  let json: unknown;
  try {
    json = JSON.parse(secret);
  } catch {
    throw new Error(`${reference} isn't JSON, so it has no field ${field}`);
  }
  const value = (json as Record<string, unknown>)?.[field];
  guard(value !== undefined, `${reference} has no field ${field}`);
  return typeof value === 'string' ? value : JSON.stringify(value);
};

// HTTP through Node, not the window's fetch: these services don't allow CORS
interface Answer {
  status: number;
  text: string;
}
export const request = (url: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new Promise<Answer>((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(parsed, { method, headers, timeout: 15_000 }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on('timeout', () => req.destroy(new Error(`${parsed.host} didn't answer in 15 seconds`)));
    req.on('error', reject);
    req.end(body);
  });

const json = (answer: Answer, what: string) => {
  if (answer.status < 200 || answer.status >= 300) {
    throw new Error(`${what}: ${answer.status} ${answer.text.slice(0, 300)}`);
  }
  return JSON.parse(answer.text);
};

const run = (command: string, args: string[]) => new Promise<string>((resolve, reject) => {
  execFile(command, args, { timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error((error as NodeJS.ErrnoException).code === 'ENOENT' ? `${command} isn't installed, or isn't on the PATH` : `${command}: ${(stderr || error.message).trim()}`));
    } else {
      resolve(stdout);
    }
  });
});

// A Vault path as the allowlist sees it and Vault gets it: no . or ..
// segments (encoded or not), which the URL would collapse past an allowed
// prefix, and no query, fragment or backslash
const vaultPath = (secretPath: string) => {
  const trimmed = secretPath.replace(/^\/+/, '');
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = '';
  }
  const segments = decoded.split('/');
  guard(decoded && !/[?#\\]/.test(decoded) && segments.every(segment => segment && segment !== '.' && segment !== '..'), `${secretPath} isn't a Vault secret path, such as secret/data/myapp`);
  return trimmed;
};

// HashiCorp Vault: a KV secret, version 1 or 2, with VAULT_ADDR and VAULT_TOKEN
// (or ~/.vault-token, as the vault CLI leaves it)
export async function readVaultSecret(rawPath: string, field: string, allowedSecrets: string, env = processEnv) {
  const secretPath = vaultPath(rawPath);
  const reference = `vault:${secretPath}`;
  assertSecretAllowed(reference, allowedSecrets);
  const address = (env.VAULT_ADDR || '').replace(/\/+$/, '');
  guard(address, 'Set VAULT_ADDR to the Vault server, for example https://vault.example.com:8200');
  const token = env.VAULT_TOKEN || await fs.promises.readFile(path.join(os.homedir(), '.vault-token'), 'utf8').then(text => text.trim(), () => '');
  guard(token, 'Set VAULT_TOKEN, or sign in with the vault CLI');
  const secret = await cached(`${reference} ${address}`, async () => {
    const answer = json(await request(`${address}/v1/${secretPath.replace(/^\/+/, '')}`, { headers: { 'X-Vault-Token': token, ...(env.VAULT_NAMESPACE ? { 'X-Vault-Namespace': env.VAULT_NAMESPACE } : {}) } }), `Vault ${secretPath}`);
    // KV version 2 nests the values once more
    const data = answer.data?.data && answer.data?.metadata ? answer.data.data : answer.data;
    return JSON.stringify(data ?? {});
  });
  guard(field, `Give the field of ${reference} to read`);
  return pick(secret, field, reference);
}

// 1Password: a secret reference (op://vault/item/field), read with the op CLI
export async function readOnePasswordSecret(reference: string, allowedSecrets: string) {
  guard(/^op:\/\/[^/]+\/[^/]+\/.+/.test(reference), `${reference} isn't a 1Password secret reference: op://vault/item/field`);
  assertSecretAllowed(reference, allowedSecrets);
  return cached(reference, async () => (await run('op', ['read', '--no-newline', reference])).replace(/\r?\n$/, ''));
}

// AWS Secrets Manager, with the AWS_* credentials in the environment, at
// AWS_ENDPOINT_URL_SECRETS_MANAGER or AWS_ENDPOINT_URL if set (LocalStack)
export async function readAwsSecret(secretId: string, field: string, region: string, allowedSecrets: string, env = processEnv) {
  const reference = `aws:${secretId}`;
  assertSecretAllowed(reference, allowedSecrets);
  const awsRegion = region || env.AWS_REGION || env.AWS_DEFAULT_REGION || '';
  guard(awsRegion, 'Give the region, or set AWS_REGION');
  // it goes into the host the signed request is sent to
  guard(/^[a-z]{2}(-[a-z]+)+-\d+$/.test(awsRegion), `${awsRegion} isn't an AWS region, such as us-east-1`);
  guard(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY, 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN for temporary credentials)');
  const endpoint = new URL(env.AWS_ENDPOINT_URL_SECRETS_MANAGER || env.AWS_ENDPOINT_URL || `https://secretsmanager.${awsRegion}.amazonaws.com`);
  const secret = await cached(`${reference} ${awsRegion} ${endpoint.origin}`, async () => {
    const signed = aws4.sign({
      host: endpoint.host,
      path: endpoint.pathname || '/',
      method: 'POST',
      service: 'secretsmanager',
      region: awsRegion,
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'secretsmanager.GetSecretValue' },
      body: JSON.stringify({ SecretId: secretId }),
    }, { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN });
    const answer = json(await request(`${endpoint.origin}${endpoint.pathname}`, { method: 'POST', headers: signed.headers as Record<string, string>, body: signed.body as string }), `AWS secret ${secretId}`);
    guard(typeof answer.SecretString === 'string', `AWS secret ${secretId} has no text value`);
    return answer.SecretString as string;
  });
  return pick(secret, field, reference);
}

// Google Cloud Secret Manager, with the application default credentials
export async function readGcpSecret(name: string, field: string, allowedSecrets: string) {
  const resource = /\/versions\//.test(name) ? name : `${name}/versions/latest`;
  guard(/^projects\/[^/]+\/secrets\/[^/]+\/versions\/[^/]+$/.test(resource), `${name} isn't a secret name: projects/<project>/secrets/<secret>, optionally /versions/<version>`);
  const reference = `gcp:${resource.replace(/\/versions\/latest$/, '')}`;
  assertSecretAllowed(reference, allowedSecrets);
  const secret = await cached(`gcp:${resource}`, async () => {
    const token = await getGcpAccessToken({ kind: 'adc' });
    const answer = json(await request(`https://secretmanager.googleapis.com/v1/${resource}:access`, { headers: { Authorization: `Bearer ${token}` } }), `Google Cloud secret ${name}`);
    return Buffer.from(answer.payload?.data || '', 'base64').toString('utf8');
  });
  return pick(secret, field, reference);
}

// Azure Key Vault, with the Azure CLI's sign-in
export async function readAzureSecret(vault: string, name: string, field: string, allowedSecrets: string) {
  guard(/^[\w-]+$/.test(vault) && /^[\w-]+$/.test(name), 'Give the key vault and secret names');
  const reference = `azure:${vault}/${name}`;
  assertSecretAllowed(reference, allowedSecrets);
  const secret = await cached(reference, async () => {
    const { accessToken } = JSON.parse(await run('az', ['account', 'get-access-token', '--resource', 'https://vault.azure.net', '--output', 'json']));
    const answer = json(await request(`https://${vault}.vault.azure.net/secrets/${name}?api-version=7.4`, { headers: { Authorization: `Bearer ${accessToken}` } }), `Azure secret ${vault}/${name}`);
    return String(answer.value ?? '');
  });
  return pick(secret, field, reference);
}
