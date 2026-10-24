// OAuth 2.0 client authentication with a signed JWT (private_key_jwt: RFC 7523
// and OpenID Connect Core 9) rather than a client secret: the token request
// carries a short-lived assertion, signed with the client's private key, whose
// public key the provider has. Also the JWT bearer grant's assertion.
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

// The JWT bearer grant's assertion (RFC 7523 2.1), which stands for the grant
// itself: from an issuer (such as a service account) about a subject (the
// user to act as, or the issuer). Google's service accounts also want the
// scope as a claim.
export function grantAssertion({ issuer, subject, audience, scope, privateKey, algorithm = 'RS256', keyId, now = Date.now() }: {
  issuer: string;
  subject?: string;
  // the token endpoint, unless the provider names another
  audience: string;
  scope?: string;
  privateKey: string;
  algorithm?: string;
  keyId?: string;
  now?: number;
}) {
  if (!CLIENT_ASSERTION_ALGORITHMS.includes(algorithm)) {
    throw new Error(`The assertion can't be signed with ${algorithm}: use one of ${CLIENT_ASSERTION_ALGORITHMS.join(', ')}`);
  }
  const issuedAt = Math.floor(now / 1000);
  return signJws(
    { alg: algorithm, typ: 'JWT', ...(keyId ? { kid: keyId } : {}) },
    {
      iss: issuer,
      sub: subject || issuer,
      aud: audience,
      ...(scope ? { scope } : {}),
      jti: crypto.randomUUID(),
      iat: issuedAt,
      exp: issuedAt + 300,
    },
    privateKey,
  );
}
