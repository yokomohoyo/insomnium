// The JWT auth: a token signed on each send from the request's claims, with a
// secret or a private key, sent as a header (Bearer, by default) or a query
// parameter. `iat` is set, and `exp` too when the token is given a lifetime,
// unless the claims set them.
import { JWS_KEY_ALGORITHMS, JWS_SECRET_ALGORITHMS, signJws } from './jws';

export interface JwtAuth {
  algorithm?: string;
  secret?: string;
  secretBase64?: boolean;
  privateKey?: string;
  // JSON text
  payload?: string;
  header?: string;
  // seconds; empty for no exp
  expiresIn?: string;
}

const object = (text: string | undefined, what: string) => {
  if (!text?.trim()) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`The JWT's ${what} isn't JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The JWT's ${what} has to be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

export function generateJwt(auth: JwtAuth, now = Date.now()) {
  const algorithm = auth.algorithm || 'HS256';
  if (![...JWS_SECRET_ALGORITHMS, ...JWS_KEY_ALGORITHMS].includes(algorithm)) {
    throw new Error(`A JWT can't be signed with ${algorithm}: use one of ${[...JWS_SECRET_ALGORITHMS, ...JWS_KEY_ALGORITHMS].join(', ')}`);
  }
  const issuedAt = Math.floor(now / 1000);
  const lifetime = Number(auth.expiresIn);
  // the payload as written, then iat and exp where it hasn't set them
  const claims: Record<string, unknown> = { ...object(auth.payload, 'payload') };
  if (!('iat' in claims)) {
    claims.iat = issuedAt;
  }
  if (!('exp' in claims) && auth.expiresIn?.trim() && Number.isFinite(lifetime) && lifetime > 0) {
    claims.exp = Number(claims.iat) + lifetime;
  }
  const header = { ...object(auth.header, 'header'), alg: algorithm, typ: 'JWT' };
  if (JWS_SECRET_ALGORITHMS.includes(algorithm)) {
    if (!auth.secret) {
      throw new Error(`A JWT signed with ${algorithm} needs a secret`);
    }
    return signJws(header, claims, auth.secretBase64 ? Buffer.from(auth.secret, 'base64') : auth.secret);
  }
  if (!auth.privateKey) {
    throw new Error(`A JWT signed with ${algorithm} needs a private key`);
  }
  return signJws(header, claims, auth.privateKey);
}
