import { describe, expect, it } from '@jest/globals';
import crypto from 'crypto';

import { CLIENT_ASSERTION_TYPE, clientAssertion } from '../client-assertion';
import { withClientAuthentication } from '../get-token';

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = (key: crypto.KeyObject) => key.export({ type: 'pkcs8', format: 'pem' }).toString();

const decode = (jwt: string) => {
  const [header, claims, signature] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
    signed: Buffer.from(`${header}.${claims}`),
    signature: Buffer.from(signature, 'base64url'),
  };
};

describe('clientAssertion()', () => {
  const base = { clientId: 'my-client', audience: 'https://auth.example.com/token', now: 1_700_000_000_000 };

  it('signs the claims a token endpoint checks, with RS256 by default', () => {
    const { header, claims, signed, signature } = decode(clientAssertion({ ...base, privateKey: pem(rsa.privateKey), keyId: 'key-1' }));

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'key-1' });
    expect(claims).toMatchObject({ iss: 'my-client', sub: 'my-client', aud: 'https://auth.example.com/token', iat: 1_700_000_000, exp: 1_700_000_300 });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(crypto.verify('sha256', signed, rsa.publicKey, signature)).toBe(true);
  });

  it('signs with ECDSA as JWS has it, and with RSA-PSS', () => {
    const es = decode(clientAssertion({ ...base, privateKey: pem(ec.privateKey), algorithm: 'ES256' }));
    expect(es.signature).toHaveLength(64);
    expect(crypto.verify('sha256', es.signed, { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, es.signature)).toBe(true);

    const ps = decode(clientAssertion({ ...base, privateKey: pem(rsa.privateKey), algorithm: 'PS256' }));
    expect(crypto.verify('sha256', ps.signed, { key: rsa.publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, ps.signature)).toBe(true);
  });

  it('refuses an algorithm it cannot sign with', () => {
    expect(() => clientAssertion({ ...base, privateKey: pem(rsa.privateKey), algorithm: 'HS256' })).toThrow("can't be signed with HS256");
  });
});

describe('withClientAuthentication()', () => {
  const grant = [{ name: 'grant_type', value: 'client_credentials' }];
  const oauth = { type: 'oauth2' as const, grantType: 'client_credentials' as const, clientId: 'my-client', clientSecret: 's3cret', accessTokenUrl: 'https://auth.example.com/token' };

  it('sends the id and secret as a Basic header, or in the body', () => {
    expect(withClientAuthentication(oauth, grant, [])).toEqual({
      params: grant,
      headers: [{ name: 'Authorization', value: `Basic ${Buffer.from('my-client:s3cret').toString('base64')}` }],
    });
    expect(withClientAuthentication({ ...oauth, credentialsInBody: true }, grant, [])).toEqual({
      params: [...grant, { name: 'client_id', value: 'my-client' }, { name: 'client_secret', value: 's3cret' }],
      headers: [],
    });
  });

  it('sends a client assertion instead of the secret', () => {
    const { params, headers } = withClientAuthentication({ ...oauth, usePrivateKeyJwt: true, privateKey: pem(rsa.privateKey) }, grant, []);

    expect(headers).toEqual([]);
    expect(params.map(param => param.name)).toEqual(['grant_type', 'client_id', 'client_assertion_type', 'client_assertion']);
    expect(params.find(param => param.name === 'client_assertion_type')?.value).toBe(CLIENT_ASSERTION_TYPE);
    expect(JSON.stringify(params)).not.toContain('s3cret');
    const { claims } = decode(params.find(param => param.name === 'client_assertion')!.value);
    expect(claims.aud).toBe('https://auth.example.com/token');
    expect(() => withClientAuthentication({ ...oauth, usePrivateKeyJwt: true }, grant, [])).toThrow('private key');
  });
});
