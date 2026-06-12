import { describe, expect, it } from '@jest/globals';

import { assertSafeHeaders, assertSafeRequestUrl, redactSecrets } from '../util';

describe('assertSafeRequestUrl', () => {
  it('allows http and https URLs', () => {
    expect(() => assertSafeRequestUrl('http://example.com/api')).not.toThrow();
    expect(() => assertSafeRequestUrl('https://example.com/api')).not.toThrow();
  });

  it('allows loopback and private hosts (local dev is a core use case)', () => {
    expect(() => assertSafeRequestUrl('http://localhost:3000/')).not.toThrow();
    expect(() => assertSafeRequestUrl('http://127.0.0.1:8080/')).not.toThrow();
    expect(() => assertSafeRequestUrl('http://192.168.1.10/')).not.toThrow();
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => assertSafeRequestUrl('file:///etc/passwd')).toThrow(/scheme/);
    expect(() => assertSafeRequestUrl('gopher://example.com/')).toThrow(/scheme/);
    expect(() => assertSafeRequestUrl('dict://example.com/')).toThrow(/scheme/);
  });

  it('rejects cloud-metadata endpoints', () => {
    expect(() => assertSafeRequestUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/metadata/);
    expect(() => assertSafeRequestUrl('http://metadata.google.internal/computeMetadata/v1/')).toThrow(/metadata/);
  });

  it('rejects malformed URLs', () => {
    expect(() => assertSafeRequestUrl('not-a-url')).toThrow(/valid absolute URL/);
    expect(() => assertSafeRequestUrl('')).toThrow(/valid absolute URL/);
  });
});

describe('redactSecrets', () => {
  const R = '***REDACTED***';

  it('masks credential values in auth strategies while keeping structure', () => {
    const out = redactSecrets({ type: 'bearer', token: 'abc123', disabled: false });
    expect(out).toEqual({ type: 'bearer', token: R, disabled: false });
  });

  it('masks basic-auth passwords but leaves usernames', () => {
    const out = redactSecrets({ type: 'basic', username: 'alice', password: 'hunter2' });
    expect(out).toEqual({ type: 'basic', username: 'alice', password: R });
  });

  it('masks nested service-account credentials including snake_case keys', () => {
    const out = redactSecrets({
      authentication: { type: 'gcp-id-token', audience: 'https://x', credentials: { client_email: 'sa@x', private_key: '-----BEGIN-----' } },
    });
    // The whole credentials blob is masked.
    expect(out.authentication.credentials).toBe(R);
    expect(out.authentication.audience).toBe('https://x');
  });

  it('masks sensitive header values by header name', () => {
    const out = redactSecrets({ headers: [
      { name: 'Authorization', value: 'Bearer secret' },
      { name: 'Accept', value: 'application/json' },
    ] });
    expect(out.headers[0].value).toBe(R);
    expect(out.headers[1].value).toBe('application/json');
  });

  it('does not mask empty values or unrelated fields, and does not mutate the input', () => {
    const input = { type: 'bearer', token: '', url: 'https://api.example.com' };
    const out = redactSecrets(input);
    expect(out).toEqual({ type: 'bearer', token: '', url: 'https://api.example.com' });
    expect(input.token).toBe(''); // input untouched
  });

  it('masks the API-key secret value but leaves the header-name `key`', () => {
    const out = redactSecrets({ type: 'apikey', addTo: 'header', key: 'X-API-Key', value: 'super-secret' });
    expect(out).toEqual({ type: 'apikey', addTo: 'header', key: 'X-API-Key', value: R });
  });

  it('masks the Hawk HMAC `key`', () => {
    const out = redactSecrets({ type: 'hawk', id: 'dh37', key: 'hmac-secret', algorithm: 'sha256' });
    expect(out).toEqual({ type: 'hawk', id: 'dh37', key: R, algorithm: 'sha256' });
  });

  it('masks substring secrets like clientSecret / consumerSecret / tokenSecret', () => {
    const out = redactSecrets({ type: 'oauth1', consumerKey: 'ck', consumerSecret: 'cs', tokenSecret: 'ts' });
    expect(out).toEqual({ type: 'oauth1', consumerKey: 'ck', consumerSecret: R, tokenSecret: R });
  });

  it('masks the OAuth authorization `code` only inside an oauth strategy, not in arbitrary bodies', () => {
    expect(redactSecrets({ type: 'oauth2', code: 'authz-code' })).toEqual({ type: 'oauth2', code: R });
    // A `code` field in an ordinary request body must NOT be masked.
    expect(redactSecrets({ type: 'Request', body: { code: 200, message: 'ok' } }))
      .toEqual({ type: 'Request', body: { code: 200, message: 'ok' } });
  });

  it('does not infinite-loop on a circular structure', () => {
    const a: any = { type: 'basic', password: 'p' };
    a.self = a;
    expect(() => redactSecrets(a)).not.toThrow();
    expect(redactSecrets(a).password).toBe(R);
  });
});

describe('assertSafeHeaders', () => {
  it('allows ordinary headers, empty values, and duplicate names', () => {
    expect(() => assertSafeHeaders([
      { name: 'Accept', value: 'application/json' },
      { name: 'X-Empty', value: '' },
      { name: 'Set-Cookie', value: 'a=1' },
      { name: 'Set-Cookie', value: 'b=2' },
    ])).not.toThrow();
    expect(() => assertSafeHeaders(undefined)).not.toThrow();
  });

  it('rejects CR/LF/NUL injection in a header value', () => {
    expect(() => assertSafeHeaders([{ name: 'X-Evil', value: 'a\r\nInjected: 1' }])).toThrow(/CR, LF, or NUL/);
    expect(() => assertSafeHeaders([{ name: 'X-Evil', value: 'a\nb' }])).toThrow(/CR, LF, or NUL/);
    expect(() => assertSafeHeaders([{ name: 'X-Evil', value: 'a\0b' }])).toThrow(/CR, LF, or NUL/);
  });

  it('rejects out-of-charset header names', () => {
    expect(() => assertSafeHeaders([{ name: 'Bad Header', value: 'x' }])).toThrow(/not a valid header name/);
    expect(() => assertSafeHeaders([{ name: 'X-Inject\r\nFoo', value: 'x' }])).toThrow(/CR, LF, or NUL/);
  });

  it('skips disabled entries', () => {
    expect(() => assertSafeHeaders([{ name: 'X-Evil', value: 'a\r\nb', disabled: true }])).not.toThrow();
  });
});
