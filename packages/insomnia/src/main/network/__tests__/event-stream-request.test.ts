import { describe, expect, it } from '@jest/globals';

import { AUTH_DIGEST, CONTENT_TYPE_FORM_DATA, CONTENT_TYPE_FORM_URLENCODED } from '../../../common/constants';
import { buildEventStreamCurlRequest, EventStreamConnection } from '../event-stream-request';

const connection = (patch: Partial<EventStreamConnection> = {}): EventStreamConnection => ({
  url: 'http://localhost:4000/events/news?since=42',
  method: 'GET',
  body: {},
  headers: [
    { name: 'Accept', value: 'text/event-stream' },
    { name: 'X-Trace', value: 'abc' },
    { name: 'Authorization', value: 'Bearer s3cret' },
  ],
  authentication: [],
  cookieJar: { cookies: [] } as unknown as EventStreamConnection['cookieJar'],
  cookies: [],
  suppressUserAgent: false,
  settingSendCookies: true,
  settingStoreCookies: true,
  settingFollowRedirects: 'global',
  settingRebuildPath: true,
  ...patch,
});

describe('buildEventStreamCurlRequest()', () => {
  it('sends exactly the resolved headers', () => {
    const { headerStrings } = buildEventStreamCurlRequest(connection());
    expect(headerStrings).toEqual([
      'Accept: text/event-stream',
      'X-Trace: abc',
      'Authorization: Bearer s3cret',
      'Accept-Encoding:',
      'content-type:',
    ]);
  });

  it('uses the resolved url, so proxy choice and cookie scoping see the real host', () => {
    const { req } = buildEventStreamCurlRequest(connection({ url: 'https://api.example.com/stream' }));
    expect(req.url).toBe('https://api.example.com/stream');
  });

  it('sends a GET without a body', () => {
    const { req, requestBody } = buildEventStreamCurlRequest(connection());
    expect(req.method).toBe('GET');
    expect(requestBody).toBeUndefined();
  });

  it('sends the method and text body, as streaming APIs that want a POST need', () => {
    const { req, requestBody, headerStrings } = buildEventStreamCurlRequest(connection({
      method: 'POST',
      body: { mimeType: 'application/json', text: '{"stream": true}' },
      headers: [{ name: 'Accept', value: 'text/event-stream' }, { name: 'Content-Type', value: 'application/json' }],
    }));
    expect(req.method).toBe('POST');
    expect(requestBody).toBe('{"stream": true}');
    expect(headerStrings).toEqual([
      'Accept: text/event-stream',
      'Content-Type: application/json',
      'Expect:',
      'Transfer-Encoding:',
      'Accept-Encoding:',
    ]);
  });

  it('sends a form URL-encoded body encoded', () => {
    const { requestBody } = buildEventStreamCurlRequest(connection({
      method: 'POST',
      body: { mimeType: CONTENT_TYPE_FORM_URLENCODED, params: [{ name: 'q', value: 'a b' }, { name: 'n', value: '1' }] },
    }));
    expect(requestBody).toBe('q=a+b&n=1');
  });

  it.each([
    ['a multipart body', { mimeType: CONTENT_TYPE_FORM_DATA, params: [{ name: 'f', value: 'x' }] }],
    ['a file body', { fileName: '/tmp/upload.bin' }],
  ])('refuses %s, which a stream can\'t send', (_, body) => {
    expect(() => buildEventStreamCurlRequest(connection({ method: 'POST', body }))).toThrow(/text or form URL-encoded body/);
  });

  it('carries the resolved auth and settings for curl-native auth, cookies and redirects', () => {
    const authentication = [{ type: AUTH_DIGEST, username: 'u', password: 'p' }];
    const { req } = buildEventStreamCurlRequest(connection({
      authentication,
      suppressUserAgent: true,
      settingSendCookies: false,
      settingFollowRedirects: 'off',
      settingRebuildPath: false,
    }));
    expect(req).toMatchObject({
      authentication,
      suppressUserAgent: true,
      settingSendCookies: false,
      settingFollowRedirects: 'off',
      settingRebuildPath: false,
    });
  });

  it('rejects a header that would inject another header line', () => {
    expect(() => buildEventStreamCurlRequest(connection({
      headers: [{ name: 'X-Evil', value: 'a\r\nX-Injected: 1' }],
    }))).toThrow(/header 'X-Evil' contains a CR, LF, or NUL/);
  });
});
