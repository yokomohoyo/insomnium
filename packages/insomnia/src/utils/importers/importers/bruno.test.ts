import { describe, expect, it } from '@jest/globals';

import { convert } from './bruno';

const collection = (request: object) => JSON.stringify({
  name: 'Auth',
  version: '1',
  items: [{ type: 'http-request', name: 'request', seq: 1, request: { url: 'https://example.com', method: 'GET', ...request } }],
});
// the import pipeline puts the auth in a list later
const request = async (fields: object) => (await convert(collection(fields)))?.find(({ _type }) => _type === 'request') as any;

describe('bruno', () => {
  it('leaves other formats to their importers', async () => {
    expect(await convert('not json')).toBeNull();
    expect(await convert(JSON.stringify({ info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, name: 'p', version: '1', items: [] }))).toBeNull();
    expect(await convert(JSON.stringify({ _type: 'export', __export_format: 4, resources: [] }))).toBeNull();
    // Hoppscotch environments name their variables by key, and its collections
    // have a name and variables too
    expect(await convert(JSON.stringify([{ name: 'h', variables: [{ key: 'a', value: 'b' }] }]))).toBeNull();
    expect(await convert(JSON.stringify({ v: 2, name: 'h', folders: [], requests: [], variables: [] }))).toBeNull();
  });

  it('imports one environment, or a list of them', async () => {
    expect(await convert(JSON.stringify({ name: 'One', variables: [{ name: 'a', value: '1', enabled: true }] }))).toEqual([
      { _id: '__ENV_1__', _type: 'environment', parentId: '__BASE_ENVIRONMENT_ID__', name: 'One', data: { a: '1' } },
    ]);
    expect(await convert(JSON.stringify([{ name: 'A', variables: [] }, { name: 'B', variables: [] }]))).toHaveLength(2);
  });

  it.each([
    [{ mode: 'digest', digest: { username: 'u', password: 'p' } }, { type: 'digest', username: 'u', password: 'p' }],
    [{ mode: 'ntlm', ntlm: { username: 'u', password: 'p', domain: 'CORP' } }, { type: 'ntlm', username: 'CORP\\u', password: 'p' }],
    [
      { mode: 'awsv4', awsv4: { accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't', service: 'execute-api', region: 'eu-west-1' } },
      { type: 'iam', accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't', service: 'execute-api', region: 'eu-west-1' },
    ],
    [
      { mode: 'oauth1', oauth1: { consumerKey: 'ck', consumerSecret: 'cs', accessToken: 'at', accessTokenSecret: 'ats', signatureMethod: 'HMAC-SHA256' } },
      { type: 'oauth1', consumerKey: 'ck', consumerSecret: 'cs', tokenKey: 'at', tokenSecret: 'ats', signatureMethod: 'HMAC-SHA256' },
    ],
    [
      { mode: 'oauth2', oauth2: { grantType: 'authorization_code', authorizationUrl: 'https://a', accessTokenUrl: 'https://t', callbackUrl: 'https://cb', clientId: 'id', pkce: true } },
      { type: 'oauth2', grantType: 'authorization_code', authorizationUrl: 'https://a', accessTokenUrl: 'https://t', redirectUrl: 'https://cb', clientId: 'id', usePkce: true, credentialsInBody: true },
    ],
    [{ mode: 'apikey', apikey: { key: 'k', value: 'v', placement: 'queryparams' } }, { type: 'apikey', key: 'k', value: 'v', addTo: 'queryParams' }],
  ])('maps %j auth', async (auth, expected) => {
    expect((await request({ auth })).authentication).toEqual(expect.objectContaining(expected));
  });

  it('sends no auth for none, and for what Insomnium has no auth for', async () => {
    expect((await request({ auth: { mode: 'none' } })).authentication).toEqual({});
    expect((await request({ auth: { mode: 'wsse', wsse: { username: 'u' } } })).authentication).toEqual({});
    expect((await request({})).authentication).toEqual({});
  });

  it('sends a file body, and GraphQL whose variables are not JSON without them', async () => {
    expect((await request({ body: { mode: 'file', file: [{ filePath: '/a.bin', contentType: 'image/png', selected: false }, { filePath: '/b.bin', selected: true }] } })).body)
      .toEqual({ mimeType: 'application/octet-stream', fileName: '/b.bin' });
    expect((await request({ body: { mode: 'graphql', graphql: { query: '{ a }', variables: '{ "x": {{x}} }' } } })).body)
      .toEqual({ mimeType: 'application/graphql', text: '{"query":"{ a }"}' });
  });
});
