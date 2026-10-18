import { describe, expect, it } from '@jest/globals';
import crypto from 'crypto';

import { getAuthHeaders, getAuthQueryParamsList } from '../authentication';
import { edgeGridHeader, edgeGridTimestamp } from '../edgegrid';
import { generateJwt } from '../jwt-auth';

const decode = (jwt: string) => {
  const [header, claims, signature] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
    signed: Buffer.from(`${header}.${claims}`),
    signature: Buffer.from(signature, 'base64url'),
  };
};

describe('JWT auth', () => {
  it("signs with a secret: jwt.io's example token", () => {
    expect(generateJwt({ algorithm: 'HS256', secret: 'your-256-bit-secret', payload: '{"sub":"1234567890","name":"John Doe","iat":1516239022}' }))
      .toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  it('sets iat, and exp from the lifetime, unless the payload has them; and adds to the header', () => {
    const { header, claims } = decode(generateJwt({ secret: 's', payload: '{"sub":"kim"}', expiresIn: '300', header: '{"kid":"key-1","alg":"none"}' }, 1_700_000_000_000));
    expect(header).toEqual({ kid: 'key-1', alg: 'HS256', typ: 'JWT' });
    expect(claims).toEqual({ sub: 'kim', iat: 1_700_000_000, exp: 1_700_000_300 });
    expect(decode(generateJwt({ secret: 's', payload: '{"exp":1}', expiresIn: '300' })).claims.exp).toBe(1);
    expect(decode(generateJwt({ secret: 's', expiresIn: '' })).claims).not.toHaveProperty('exp');
  });

  it('decodes a Base64 secret, and signs with a private key', () => {
    const secret = Buffer.from('raw secret bytes');
    const fromBase64 = generateJwt({ secret: secret.toString('base64'), secretBase64: true, payload: '{}' }, 0);
    const [input, signature] = [fromBase64.split('.').slice(0, 2).join('.'), fromBase64.split('.')[2]];
    expect(signature).toBe(crypto.createHmac('sha256', secret).update(input).digest('base64url'));

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rs = decode(generateJwt({ algorithm: 'RS256', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), payload: '{"sub":"kim"}' }));
    expect(crypto.verify('sha256', rs.signed, publicKey, rs.signature)).toBe(true);
  });

  it('says what it needs', () => {
    expect(() => generateJwt({ algorithm: 'HS256' })).toThrow('needs a secret');
    expect(() => generateJwt({ algorithm: 'ES256' })).toThrow('needs a private key');
    expect(() => generateJwt({ secret: 's', payload: '[1]' })).toThrow('JSON object');
    expect(() => generateJwt({ secret: 's', payload: '{ nope' })).toThrow("isn't JSON");
    expect(() => generateJwt({ algorithm: 'none', secret: 's' })).toThrow("can't be signed with none");
  });

  it('goes in the Authorization header, or a query parameter', async () => {
    const strategy = { type: 'jwt', secret: 's', payload: '{"sub":"kim"}', addTo: 'header', prefix: 'Bearer' };
    const [header] = await getAuthHeaders({ authentication: strategy, method: 'GET', body: {}, headers: [] } as any, 'https://api.example.com');
    expect(header.name).toBe('Authorization');
    expect(header.value).toMatch(/^Bearer eyJ/);
    expect(await getAuthHeaders({ authentication: { ...strategy, addTo: 'queryParams' }, method: 'GET', body: {}, headers: [] } as any, 'https://api.example.com')).toEqual([]);
    const [param] = getAuthQueryParamsList({ ...strategy, addTo: 'queryParams', queryParamKey: 'access_token' });
    expect(param.name).toBe('access_token');
    expect(decode(param.value).claims.sub).toBe('kim');
  });
});

describe('Akamai EdgeGrid', () => {
  // Akamai's own test cases (AkamaiOPEN-edgegrid-python: testdata.json and testcases.json)
  const credentials = {
    clientToken: 'akab-client-token-xxx-xxxxxxxxxxxxxxxx',
    clientSecret: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=',
    accessToken: 'akab-access-token-xxx-xxxxxxxxxxxxxxxx',
  };
  const signature = (header: string) => header.slice(header.indexOf('signature=') + 'signature='.length);
  const signedAt = { timestamp: '20140321T19:34:21+0000', nonce: 'nonce-xx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' };
  const baseUrl = 'https://akaa-baseurl-xxxxxxxxxxx-xxxxxxxxxxxxx.luna.akamaiapis.net';

  it("signs as Akamai's own libraries do", () => {
    expect(edgeGridHeader(credentials, { method: 'GET', url: `${baseUrl}/`, headers: [] }, signedAt)).toBe(
      'EG1-HMAC-SHA256 client_token=akab-client-token-xxx-xxxxxxxxxxxxxxxx;access_token=akab-access-token-xxx-xxxxxxxxxxxxxxxx;'
      + 'timestamp=20140321T19:34:21+0000;nonce=nonce-xx-xxxx-xxxx-xxxx-xxxxxxxxxxxx;signature=tL+y4hxyHxgWVD30X3pWnGKHcPzmrIF+LThiAOhMxYU=',
    );
    const signed = { ...credentials, headersToSign: 'X-Test1,X-Test2,X-Test3', maxBody: '2048' };
    expect(signature(edgeGridHeader(signed, { method: 'GET', url: `${baseUrl}/testapi/v1/t1?p1=1&p2=2`, headers: [] }, signedAt)))
      .toBe('hKDH1UlnQySSHjvIcZpDMbQHihTQ0XyVAKZaApabdeA=');
    expect(signature(edgeGridHeader(signed, { method: 'POST', url: `${baseUrl}/testapi/v1/t3`, headers: [], body: 'datadatadatadatadatadatadatadata' }, signedAt)))
      .toBe('hXm4iCxtpN22m4cbZb4lVLW5rhX8Ca82vCFqXzSTPe4=');
    expect(signature(edgeGridHeader(signed, { method: 'GET', url: `${baseUrl}/testapi/v1/t4`, headers: [{ name: 'X-Test1', value: '"     test-header-with-spaces     "' }] }, signedAt)))
      .toBe('ucq2AbjCNtobHfCTuS38fdkl5UDdWHZhQX46fYR8CqI=');
  });

  it("covers the path and query, the chosen headers, and a POST's body", () => {
    const sign = (request: Parameters<typeof edgeGridHeader>[1], auth = {}) => edgeGridHeader({ ...credentials, ...auth }, request, signedAt);
    const get = sign({ method: 'GET', url: `${baseUrl}/papi/v1/groups?contractId=1`, headers: [] });
    expect(get).not.toBe(sign({ method: 'GET', url: `${baseUrl}/papi/v1/groups?contractId=2`, headers: [] }));
    // a header counts only when chosen, and its spacing doesn't
    const withHeader = sign({ method: 'GET', url: `${baseUrl}/`, headers: [{ name: 'X-Test1', value: ' a   b ' }] }, { headersToSign: 'X-Test1' });
    expect(withHeader).toBe(sign({ method: 'GET', url: `${baseUrl}/`, headers: [{ name: 'x-test1', value: 'a b' }] }, { headersToSign: 'x-test1' }));
    expect(sign({ method: 'GET', url: `${baseUrl}/`, headers: [{ name: 'X-Test1', value: 'a' }] })).toBe(sign({ method: 'GET', url: `${baseUrl}/`, headers: [] }));
    // a POST's body, up to maxBody, but not a GET's
    const post = (body: string, maxBody?: string) => sign({ method: 'POST', url: `${baseUrl}/`, headers: [], body }, { maxBody });
    expect(post('abc')).not.toBe(post('abd'));
    expect(post('abc', '2')).toBe(post('abd', '2'));
    expect(sign({ method: 'GET', url: `${baseUrl}/`, headers: [], body: 'abc' })).toBe(sign({ method: 'GET', url: `${baseUrl}/`, headers: [] }));
  });

  it('dates its signature in UTC, and needs the three credentials', () => {
    expect(edgeGridTimestamp(new Date(Date.UTC(2014, 2, 21, 19, 34, 21, 456)))).toBe('20140321T19:34:21+0000');
    expect(() => edgeGridHeader({ clientToken: 'a', clientSecret: 'b' }, { method: 'GET', url: baseUrl, headers: [] })).toThrow('access token');
  });
});
