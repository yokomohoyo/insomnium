import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  _resetGcpIdTokenCache,
  defaultAudienceForUrl,
  getGcpIdToken,
} from '../get-token';

// Generate a fresh RSA key per test run so tests don't ship a real-looking
// private key in the source tree.
function generateSaKey(overrides: Record<string, unknown> = {}): string {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    private_key_id: 'kid-abc',
    private_key: privateKey,
    client_email: 'svc@test-project.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  });
}

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response);

const errJson = (status: number, body: unknown) =>
  Promise.resolve({ ok: false, status, statusText: 'Bad', text: () => Promise.resolve(JSON.stringify(body)) } as Response);

describe('getGcpIdToken', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    _resetGcpIdTokenCache();
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('mints from inline SA JSON', async () => {
    fetchMock.mockReturnValueOnce(okJson({ id_token: 'eyJhbGciOiJSUzI1NiJ9.token.sig' }));
    const token = await getGcpIdToken({
      source: { kind: 'sa-inline', json: generateSaKey() },
      audience: 'https://svc.run.app',
    });
    expect(token).toBe('eyJhbGciOiJSUzI1NiJ9.token.sig');
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = (init?.body as string);
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(body).toContain('assertion=');
  });

  it('mints from an SA file on disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcp-test-'));
    const file = path.join(dir, 'sa.json');
    await fs.writeFile(file, generateSaKey());
    fetchMock.mockReturnValueOnce(okJson({ id_token: 'tok-from-file' }));
    const token = await getGcpIdToken({ source: { kind: 'sa-file', path: file }, audience: 'https://svc.run.app' });
    expect(token).toBe('tok-from-file');
  });

  it('reuses the cached token for the same audience + identity', async () => {
    const json = generateSaKey();
    fetchMock.mockReturnValueOnce(okJson({ id_token: 'cached-once' }));
    const first = await getGcpIdToken({ source: { kind: 'sa-inline', json }, audience: 'https://svc.run.app' });
    const second = await getGcpIdToken({ source: { kind: 'sa-inline', json }, audience: 'https://svc.run.app' });
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints a fresh token when audience differs', async () => {
    const json = generateSaKey();
    fetchMock.mockReturnValueOnce(okJson({ id_token: 'tok-a' }));
    fetchMock.mockReturnValueOnce(okJson({ id_token: 'tok-b' }));
    const a = await getGcpIdToken({ source: { kind: 'sa-inline', json }, audience: 'https://a.run.app' });
    const b = await getGcpIdToken({ source: { kind: 'sa-inline', json }, audience: 'https://b.run.app' });
    expect(a).toBe('tok-a');
    expect(b).toBe('tok-b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects authorized_user without an impersonation target', async () => {
    const adcFile = JSON.stringify({ type: 'authorized_user', refresh_token: 'r', client_id: 'c', client_secret: 's' });
    await expect(
      getGcpIdToken({ source: { kind: 'sa-inline', json: adcFile }, audience: 'https://svc.run.app' }),
    ).rejects.toThrow(/impersonateServiceAccount/);
  });

  it('rejects when the file is not JSON', async () => {
    await expect(
      getGcpIdToken({ source: { kind: 'sa-inline', json: 'not json' }, audience: 'https://svc.run.app' }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('surfaces token-endpoint errors', async () => {
    fetchMock.mockReturnValueOnce(errJson(400, { error: 'invalid_grant', error_description: 'JWT signature invalid' }));
    await expect(
      getGcpIdToken({ source: { kind: 'sa-inline', json: generateSaKey() }, audience: 'https://svc.run.app' }),
    ).rejects.toThrow(/400 Bad/);
  });

  it('requires audience', async () => {
    await expect(
      getGcpIdToken({ source: { kind: 'sa-inline', json: generateSaKey() }, audience: '' }),
    ).rejects.toThrow(/audience is required/);
  });

  describe('ADC discovery', () => {
    const realEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    afterEach(() => {
      if (realEnv === undefined) {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      } else {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = realEnv;
      }
    });

    it('prefers GOOGLE_APPLICATION_CREDENTIALS over the well-known path', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcp-adc-'));
      const file = path.join(dir, 'adc.json');
      await fs.writeFile(file, generateSaKey());
      process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
      fetchMock.mockReturnValueOnce(okJson({ id_token: 'from-env-adc' }));
      const token = await getGcpIdToken({ source: { kind: 'adc' }, audience: 'https://svc.run.app' });
      expect(token).toBe('from-env-adc');
    });
  });
});

describe('defaultAudienceForUrl', () => {
  it('returns scheme+host', () => {
    expect(defaultAudienceForUrl('https://my-svc-abc.a.run.app/v1/foo')).toBe('https://my-svc-abc.a.run.app');
  });

  it('normalizes grpc(s) schemes to http(s)', () => {
    expect(defaultAudienceForUrl('grpcs://my-svc-abc.a.run.app')).toBe('https://my-svc-abc.a.run.app');
    expect(defaultAudienceForUrl('grpc://localhost:50051')).toBe('http://localhost:50051');
  });

  it('returns empty string for malformed URLs', () => {
    expect(defaultAudienceForUrl('not a url')).toBe('');
  });
});
