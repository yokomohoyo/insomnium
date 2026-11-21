/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { describe, expect, it } from '@jest/globals';

import * as models from '../../models';
import type { Response } from '../../models/response';
import { type AuditInput, auditResponse, auditStoredResponse, worstSeverity } from '../response-audit';

const SAFE_HEADERS = [
  { name: 'Content-Type', value: 'application/json' },
  { name: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { name: 'X-Content-Type-Options', value: 'nosniff' },
  { name: 'Cache-Control', value: 'no-store' },
];

const sent = (...headers: string[]) => [{ name: 'HeaderOut', value: ['GET /orders HTTP/1.1', 'Host: api.example.com', ...headers, '', ''].join('\r\n') }];

const audit = (input: Partial<AuditInput>) => auditResponse({
  url: 'https://api.example.com/orders',
  statusCode: 200,
  headers: SAFE_HEADERS,
  contentType: 'application/json',
  body: '{"id":7}',
  ...input,
});
const ids = (input: Partial<AuditInput>) => audit(input).map(({ id }) => id);
const withHeaders = (...headers: [string, string][]) => [...SAFE_HEADERS, ...headers.map(([name, value]) => ({ name, value }))];

const jwt = (header: object, payload: object) =>
  `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJl`;

describe('auditResponse()', () => {
  it('finds nothing wrong with a careful response', () => {
    expect(audit({})).toEqual([]);
    expect(audit({ timeline: [...sent('Authorization: Bearer abc'), { name: 'Text', value: 'SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384' }] })).toEqual([]);
  });

  it('has nothing to say when there was no response', () => {
    expect(audit({ statusCode: 0, url: 'http://api.example.com', headers: [] })).toEqual([]);
  });

  describe('in transit', () => {
    it('says when it went over plain http, and more loudly with credentials', () => {
      expect(audit({ url: 'http://api.example.com/orders' })).toContainEqual(expect.objectContaining({ id: 'plain-http', severity: 'medium' }));
      expect(audit({ url: 'http://api.example.com/orders', timeline: sent('Authorization: Bearer abc') }))
        .toContainEqual(expect.objectContaining({ id: 'plain-http', severity: 'high' }));
    });

    it.each([
      'http://localhost:3000/orders',
      'http://127.0.0.1/orders',
      'http://[::1]:8080/orders',
      'http://192.168.1.20/orders',
      'http://10.0.0.5/orders',
      'http://172.20.0.2/orders',
      'http://api.shop.test/orders',
      'http://nas.local/orders',
    ])('leaves plain http alone on this computer or a private network: %s', url => {
      expect(ids({ url, headers: withHeaders() })).toEqual([]);
    });

    it('asks for Strict-Transport-Security over https, but not locally', () => {
      const headers = SAFE_HEADERS.filter(({ name }) => name !== 'Strict-Transport-Security');
      expect(ids({ headers })).toEqual(['hsts-missing']);
      expect(ids({ headers, url: 'https://localhost:8443/orders' })).toEqual([]);
    });

    it.each(['TLSv1', 'TLSv1.0', 'TLSv1.1', 'SSLv3'])('says when the connection used %s', version => {
      expect(audit({ timeline: [{ name: 'Text', value: `SSL connection using ${version} / AES128-SHA` }] }))
        .toEqual([expect.objectContaining({ id: 'weak-tls', severity: 'medium', evidence: version })]);
    });

    it('is content with TLS 1.2', () => {
      expect(ids({ timeline: [{ name: 'Text', value: 'SSL connection using TLSv1.2 / ECDHE-RSA-AES128-GCM-SHA256' }] })).toEqual([]);
    });
  });

  describe('credentials', () => {
    it("names the URL's credentials, never their values", () => {
      const [finding] = audit({ url: 'https://user:hunter2@api.example.com/orders?api_key=s3cret&page=2&token=abc&key=' });

      expect(finding).toMatchObject({ id: 'secret-in-url', severity: 'medium', evidence: 'user name and password, api_key, token' });
      expect(JSON.stringify(finding)).not.toMatch(/s3cret|hunter2|abc/);
    });

    it('finds an unsigned token, sent or returned', () => {
      const unsigned = jwt({ alg: 'none' }, { sub: '7', exp: 1 }).replace(/\.[^.]*$/, '.');

      expect(audit({ timeline: sent(`Authorization: Bearer ${unsigned}`) }))
        .toEqual([expect.objectContaining({ id: 'jwt-unsigned', severity: 'high', evidence: "the request's Authorization header" })]);
      expect(audit({ body: `{"token":"${unsigned}"}` }))
        .toEqual([expect.objectContaining({ id: 'jwt-unsigned', evidence: 'the response body' })]);
    });

    it('finds a token with no expiry, once however often it appears', () => {
      const forever = jwt({ alg: 'HS256' }, { sub: '7' });

      expect(ids({ body: `{"access":"${forever}","again":"${forever}"}` })).toEqual(['jwt-no-expiry']);
      expect(ids({ body: `{"access":"${jwt({ alg: 'HS256' }, { sub: '7', exp: 1900000000 })}"}` })).toEqual([]);
    });

    it('passes over what only looks like a token', () => {
      expect(ids({ body: '{"note":"eyJub3Q.eyJqc29u.x"}' })).toEqual([]);
    });
  });

  describe('headers', () => {
    it('asks for nosniff', () => {
      expect(ids({ headers: SAFE_HEADERS.filter(({ name }) => name !== 'X-Content-Type-Options') })).toEqual(['nosniff-missing']);
    });

    it('says when CORS is open to every site', () => {
      expect(ids({ headers: withHeaders(['Access-Control-Allow-Origin', '*'], ['Access-Control-Allow-Credentials', 'true']) })).toEqual(['cors-wildcard-credentials']);
      expect(ids({ headers: withHeaders(['Access-Control-Allow-Origin', 'null']) })).toEqual(['cors-null-origin']);
      // a public API's
      expect(ids({ headers: withHeaders(['Access-Control-Allow-Origin', '*']) })).toEqual([]);
      expect(ids({ headers: withHeaders(['Access-Control-Allow-Origin', 'https://shop.example.com'], ['Access-Control-Allow-Credentials', 'true']) })).toEqual([]);
    });

    it('says when the server names its software', () => {
      const [finding] = audit({ headers: withHeaders(['Server', 'nginx/1.18.0'], ['X-Powered-By', 'Express']) });

      expect(finding).toMatchObject({ id: 'version-disclosure', severity: 'low', evidence: 'Server: nginx/1.18.0, X-Powered-By: Express' });
      expect(ids({ headers: withHeaders(['Server', 'cloudflare']) })).toEqual([]);
    });

    it("says when an authenticated GET's response may be cached", () => {
      const headers = SAFE_HEADERS.filter(({ name }) => name !== 'Cache-Control');

      expect(ids({ headers, timeline: sent('Authorization: Bearer abc') })).toEqual(['cacheable-authenticated']);
      expect(ids({ headers, timeline: sent('Cookie: session=abc') })).toEqual(['cacheable-authenticated']);
      expect(ids({ headers: [...headers, { name: 'Cache-Control', value: 'public, max-age=60' }], timeline: sent('X-API-Key: abc') })).toEqual(['cacheable-authenticated']);
      // not when nobody was signed in, it failed, or it says who it's for
      expect(ids({ headers })).toEqual([]);
      expect(ids({ headers, statusCode: 404, timeline: sent('Authorization: Bearer abc') })).toEqual([]);
      expect(ids({ headers: [...headers, { name: 'cache-control', value: 'private' }], timeline: sent('Authorization: Bearer abc') })).toEqual([]);
      expect(ids({ headers, timeline: [{ name: 'HeaderOut', value: 'POST /orders HTTP/1.1\r\nAuthorization: Bearer abc\r\n\r\n' }] })).toEqual([]);
    });

    it('asks an HTML page for its own headers', () => {
      const html = { contentType: 'text/html; charset=utf-8', body: '<html></html>' };

      expect(audit(html)).toEqual([expect.objectContaining({ id: 'html-headers-missing', evidence: 'missing Content-Security-Policy, X-Frame-Options (or frame-ancestors)' })]);
      expect(ids({ ...html, headers: withHeaders(['Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'"]) })).toEqual([]);
    });
  });

  describe('cookies', () => {
    it("names a cookie's missing flags", () => {
      const found = audit({ headers: withHeaders(
        ['Set-Cookie', 'session=abc123; Path=/'],
        ['Set-Cookie', 'theme=dark; Secure; HttpOnly'],
        ['Set-Cookie', 'ok=1; Secure; HttpOnly; SameSite=Lax'],
      ) });

      expect(found).toEqual([
        expect.objectContaining({ id: 'cookie-flags', severity: 'low', title: 'A cookie without Secure, HttpOnly, SameSite', evidence: 'session' }),
        expect.objectContaining({ id: 'cookie-flags', severity: 'info', title: 'A cookie without SameSite', evidence: 'theme' }),
      ]);
      expect(JSON.stringify(found)).not.toContain('abc123');
    });

    it("doesn't ask for Secure over http on this computer", () => {
      expect(ids({ url: 'http://localhost:3000/login', headers: withHeaders(['Set-Cookie', 'session=abc; HttpOnly; SameSite=Strict']) })).toEqual([]);
    });
  });

  describe('the body', () => {
    it.each([
      ['a Python traceback', 'Traceback (most recent call last):\n  File "/app/views.py", line 12, in get'],
      ['a Java stack trace', 'java.lang.NullPointerException\n\tat com.shop.OrderService.find(OrderService.java:42)'],
      ['a JavaScript stack trace', '{"error":"TypeError: x is undefined\\n    at getOrder (/srv/app/routes/orders.js:17:11)"}'],
      ['a .NET stack trace', '   at Shop.Orders.Get(Int32 id) in C:\\src\\Shop\\Orders.cs:line 31'],
      ['a PHP error', '<b>Fatal error</b>: Uncaught Error: Call to undefined function in /var/www/index.php on line <b>9</b>'],
      ['a Go panic', 'panic: runtime error: index out of range\n\ngoroutine 1 [running]:'],
      ['a database error', '{"message":"SQLSTATE[42S02]: Base table or view not found"}'],
      ['a database error', '{"message":"You have an error in your SQL syntax; check the manual"}'],
    ])('says when it shows %s', (what, body) => {
      expect(audit({ statusCode: 500, body })).toContainEqual(expect.objectContaining({ id: 'error-details', severity: 'medium', title: `The response shows ${what}` }));
    });

    it('leaves an ordinary error alone', () => {
      expect(ids({ statusCode: 500, body: '{"error":"Something went wrong","requestId":"a1b2"}' })).toEqual([]);
      expect(ids({ statusCode: 404, body: '{"error":"Look at the docs at https://example.com/errors.html"}' })).toEqual([]);
    });

    it('names fields that look sensitive, when they have values', () => {
      const body = JSON.stringify({ id: 7, password: 'hunter2', profile: { passwordHash: '$2b$10$abc', ssn: '078-05-1120', secret: null, cvv: '' } });

      const [finding] = audit({ body });

      expect(finding).toMatchObject({ id: 'sensitive-fields', severity: 'medium', evidence: 'password, passwordHash, ssn' });
      expect(JSON.stringify(finding)).not.toMatch(/hunter2|078-05/);
      expect(ids({ body: '{"password":"********","hasPassword":true}' })).toEqual([]);
    });
  });

  it('lists the most severe first, and says which that is', () => {
    const findings = audit({
      url: 'http://api.example.com/orders?token=abc',
      headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Server', value: 'Apache/2.4.1' }],
      timeline: sent('Authorization: Basic abc'),
    });

    expect(findings.map(({ severity }) => severity)).toEqual(['high', 'medium', 'low', 'low', 'low']);
    expect(findings.every(({ owasp }) => /^API\d+:2023 /.test(owasp))).toBe(true);
    expect(worstSeverity(findings)).toBe('high');
    expect(worstSeverity([])).toBeUndefined();
  });
});

describe('auditStoredResponse()', () => {
  const stored = (patch: object, body?: string | Buffer, timeline?: object[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'response-audit-'));
    const bodyPath = body === undefined ? '' : path.join(dir, 'body');
    const timelinePath = timeline ? path.join(dir, 'timeline') : '';
    if (bodyPath) {
      fs.writeFileSync(bodyPath, zlib.gzipSync(body!));
    }
    if (timelinePath) {
      fs.writeFileSync(timelinePath, JSON.stringify(timeline));
    }
    return {
      ...models.response.init(),
      _id: 'res_1',
      statusCode: 500,
      url: 'https://api.example.com/orders/7',
      contentType: 'application/json',
      headers: SAFE_HEADERS,
      bodyPath,
      bodyCompression: 'zip',
      timelinePath,
      ...patch,
    } as Response;
  };

  it("reads the kept response's body and timeline", async () => {
    const response = stored({}, '{"error":"SQLSTATE[HY000]"}', [{ name: 'Text', value: 'SSL connection using TLSv1.1 / AES128-SHA', timestamp: 1 }]);

    expect((await auditStoredResponse(response)).map(({ id }) => id)).toEqual(['weak-tls', 'error-details']);
  });

  it("doesn't look through a body that isn't text", async () => {
    const response = stored({ contentType: 'application/octet-stream' }, 'Traceback (most recent call last)');

    expect(await auditStoredResponse(response)).toEqual([]);
  });

  it('has nothing to say about a request that failed', async () => {
    expect(await auditStoredResponse(stored({ error: 'Could not resolve host', statusCode: 0, url: 'http://api.example.com' }))).toEqual([]);
  });
});
