import { describe, expect, it } from '@jest/globals';

import { AUTH_DIGEST } from '../../../common/constants';
import { buildEventStreamCurlRequest, EventStreamConnection } from '../event-stream-request';

const connection = (patch: Partial<EventStreamConnection> = {}): EventStreamConnection => ({
  url: 'http://localhost:4000/events/news?since=42',
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

  it('describes the bodiless GET that is actually sent', () => {
    const { req } = buildEventStreamCurlRequest(connection());
    expect(req.method).toBe('GET');
    expect(req.body).toEqual({});
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
