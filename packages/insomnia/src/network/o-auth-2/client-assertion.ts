// OAuth 2.0 client authentication with a signed JWT (private_key_jwt: RFC 7523
// and OpenID Connect Core 9) rather than a client secret: the token request
// carries a short-lived assertion, signed with the client's private key, whose
// public key the provider has.
import crypto from 'crypto';

import { JWS_KEY_ALGORITHMS, signJws } from '../jws';

export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
export const CLIENT_ASSERTION_ALGORITHMS = JWS_KEY_ALGORITHMS;

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
  return signJws(
    { alg: algorithm, typ: 'JWT', ...(keyId ? { kid: keyId } : {}) },
    { iss: clientId, sub: clientId, aud: audience, jti: crypto.randomUUID(), iat: issuedAt, exp: issuedAt + 300 },
    privateKey,
  );
}
