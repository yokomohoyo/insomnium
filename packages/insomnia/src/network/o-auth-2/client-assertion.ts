// OAuth 2.0 client authentication with a signed JWT (private_key_jwt: RFC 7523
// and OpenID Connect Core 9) rather than a client secret: the token request
// carries a short-lived assertion, signed with the client's private key, whose
// public key the provider has.
import crypto from 'crypto';

export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
export const CLIENT_ASSERTION_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];

const base64Url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function clientAssertion({ clientId, audience, privateKey, algorithm = 'RS256', keyId, now = Date.now() }: {
  clientId: string;
  // the token endpoint
  audience: string;
  privateKey: string;
  algorithm?: string;
  keyId?: string;
  now?: number;
}) {
  if (!CLIENT_ASSERTION_ALGORITHMS.includes(algorithm)) {
    throw new Error(`The client assertion can't be signed with ${algorithm}: use one of ${CLIENT_ASSERTION_ALGORITHMS.join(', ')}`);
  }
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: algorithm, typ: 'JWT', ...(keyId ? { kid: keyId } : {}) };
  const claims = { iss: clientId, sub: clientId, aud: audience, jti: crypto.randomUUID(), iat: issuedAt, exp: issuedAt + 300 };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;

  const key = crypto.createPrivateKey(privateKey);
  const hash = `sha${algorithm.slice(2)}`;
  const signature = crypto.sign(hash, Buffer.from(signingInput), algorithm.startsWith('ES')
    // JWS's ECDSA signature is r and s side by side, not DER
    ? { key, dsaEncoding: 'ieee-p1363' }
    : algorithm.startsWith('PS')
      ? { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }
      : key);
  return `${signingInput}.${base64Url(signature)}`;
}
