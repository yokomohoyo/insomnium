import { describe, expect, it } from '@jest/globals';

import {
  AUTH_API_KEY,
  AUTH_BASIC,
  AUTH_BEARER,
} from '../../common/constants';
import { addAuthStrategy, getAuthStrategies, patchAuthStrategy, removeAuthStrategy } from '../../models/request';
import { getAuthHeaders, getAuthQueryParamsList } from '../authentication';

const baseReq = (auth: any): any => ({
  _id: 'req_1',
  method: 'GET',
  url: 'https://example.com',
  body: {},
  headers: [],
  parameters: [],
  authentication: auth,
});

describe('multi-auth runtime', () => {
  it('legacy single-object auth still resolves via adapter', async () => {
    const headers = await getAuthHeaders(
      baseReq({ type: AUTH_BASIC, username: 'u', password: 'p' }),
      'https://example.com',
    );
    expect(headers).toHaveLength(1);
    expect(headers[0].name).toBe('Authorization');
  });

  it('empty {} resolves to no headers', async () => {
    const headers = await getAuthHeaders(baseReq({}), 'https://example.com');
    expect(headers).toEqual([]);
  });

  it('null/undefined auth resolves to no headers', async () => {
    expect(await getAuthHeaders(baseReq(null), 'https://example.com')).toEqual([]);
    expect(await getAuthHeaders(baseReq(undefined), 'https://example.com')).toEqual([]);
  });

  it('two strategies emit two headers in declaration order', async () => {
    const auth = [
      { type: AUTH_BEARER, token: 'abc' },
      { type: AUTH_API_KEY, key: 'X-Foo', value: 'bar', addTo: 'header' },
    ];
    const headers = await getAuthHeaders(baseReq(auth), 'https://example.com');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toEqual({ name: 'Authorization', value: 'Bearer abc' });
    expect(headers[1]).toEqual({ name: 'X-Foo', value: 'bar' });
  });

  it('headerName override redirects a strategy to a custom header', async () => {
    const auth = [
      { type: AUTH_BEARER, token: 'app-tok' },
      { type: AUTH_BEARER, token: 'iap-tok', headerName: 'X-Goog-IAP-JWT-Assertion' },
    ];
    const headers = await getAuthHeaders(baseReq(auth), 'https://example.com');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toEqual({ name: 'Authorization', value: 'Bearer app-tok' });
    expect(headers[1]).toEqual({ name: 'X-Goog-IAP-JWT-Assertion', value: 'Bearer iap-tok' });
  });

  it('two strategies writing to the same header name: last wins', async () => {
    const auth = [
      { type: AUTH_BEARER, token: 'first' },
      { type: AUTH_BEARER, token: 'second' },
    ];
    const headers = await getAuthHeaders(baseReq(auth), 'https://example.com');
    expect(headers).toHaveLength(1);
    expect(headers[0].value).toBe('Bearer second');
  });

  it('disabled strategy is skipped', async () => {
    const auth = [
      { type: AUTH_BEARER, token: 'abc', disabled: true },
      { type: AUTH_API_KEY, key: 'X-Foo', value: 'bar', addTo: 'header' },
    ];
    const headers = await getAuthHeaders(baseReq(auth), 'https://example.com');
    expect(headers).toHaveLength(1);
    expect(headers[0].name).toBe('X-Foo');
  });

  it('query params aggregate across strategies', () => {
    const params = getAuthQueryParamsList([
      { type: AUTH_API_KEY, key: 'one', value: '1', addTo: 'queryParams' },
      { type: AUTH_API_KEY, key: 'two', value: '2', addTo: 'queryParams' },
    ]);
    expect(params).toHaveLength(2);
    expect(params[0]).toMatchObject({ name: 'one', value: '1' });
    expect(params[1]).toMatchObject({ name: 'two', value: '2' });
  });
});

describe('auth strategy helpers', () => {
  it('getAuthStrategies wraps legacy single-object as 1-element array', () => {
    const s = getAuthStrategies({ type: AUTH_BASIC, username: 'u' });
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe(AUTH_BASIC);
  });

  it('getAuthStrategies treats {} as empty list', () => {
    expect(getAuthStrategies({})).toEqual([]);
  });

  it('getAuthStrategies returns array passthrough', () => {
    const input = [{ type: AUTH_BEARER, token: 'x' }];
    expect(getAuthStrategies(input)).toBe(input);
  });

  it('addAuthStrategy appends to existing list', () => {
    const next = addAuthStrategy(
      [{ type: AUTH_BEARER, token: 'a' }],
      { type: AUTH_API_KEY, key: 'k', value: 'v', addTo: 'header' },
    );
    expect(next).toHaveLength(2);
    expect(next[1].type).toBe(AUTH_API_KEY);
  });

  it('patchAuthStrategy mutates only target index', () => {
    const next = patchAuthStrategy(
      [{ type: AUTH_BEARER, token: 'old' }, { type: AUTH_BASIC, username: 'u' }],
      0,
      { token: 'new' },
    );
    expect(next[0].token).toBe('new');
    expect(next[1].username).toBe('u');
  });

  it('removeAuthStrategy drops target index', () => {
    const next = removeAuthStrategy(
      [{ type: AUTH_BEARER, token: 'x' }, { type: AUTH_BASIC }],
      0,
    );
    expect(next).toHaveLength(1);
    expect(next[0].type).toBe(AUTH_BASIC);
  });
});
