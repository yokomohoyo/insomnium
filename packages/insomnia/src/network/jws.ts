// Signing a JWT (JWS compact serialization), for the JWT auth and OAuth 2's
// client assertion: HMAC with a secret (HS*), or a private key: RSA (RS*),
// RSA-PSS (PS*) or ECDSA (ES*, as JWS's r‖s rather than DER).
import crypto from 'crypto';

export const JWS_SECRET_ALGORITHMS = ['HS256', 'HS384', 'HS512'];
export const JWS_KEY_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];

export const base64Url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function signJws(header: Record<string, unknown>, claims: Record<string, unknown>, key: string | Buffer): string {
  const algorithm = String(header.alg);
  if (![...JWS_SECRET_ALGORITHMS, ...JWS_KEY_ALGORITHMS].includes(algorithm)) {
    throw new Error(`A JWT can't be signed with ${algorithm}: use one of ${[...JWS_SECRET_ALGORITHMS, ...JWS_KEY_ALGORITHMS].join(', ')}`);
  }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const hash = `sha${algorithm.slice(2)}`;
  if (algorithm.startsWith('HS')) {
    return `${signingInput}.${base64Url(crypto.createHmac(hash, key).update(signingInput).digest())}`;
  }
  const privateKey = crypto.createPrivateKey(key);
  const signature = crypto.sign(hash, Buffer.from(signingInput), algorithm.startsWith('ES')
    ? { key: privateKey, dsaEncoding: 'ieee-p1363' }
    : algorithm.startsWith('PS')
      ? { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }
      : privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}
