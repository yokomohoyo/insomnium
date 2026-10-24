export const GRANT_TYPE_AUTHORIZATION_CODE = 'authorization_code';
export const GRANT_TYPE_IMPLICIT = 'implicit';
export const GRANT_TYPE_PASSWORD = 'password';
export const GRANT_TYPE_CLIENT_CREDENTIALS = 'client_credentials';
export const GRANT_TYPE_REFRESH = 'refresh_token';
// grants named by URN: a device's sign-in with a code (RFC 8628), a JWT that
// stands for the grant (RFC 7523) and a token traded for another (RFC 8693)
export const GRANT_TYPE_DEVICE_CODE = 'urn:ietf:params:oauth:grant-type:device_code';
export const GRANT_TYPE_JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const GRANT_TYPE_TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
// the kinds of token a token exchange names (RFC 8693 3)
export const TOKEN_TYPES = ['access_token', 'refresh_token', 'id_token', 'jwt', 'saml1', 'saml2'].map(name => `urn:ietf:params:oauth:token-type:${name}`);
export const TOKEN_TYPE_ACCESS_TOKEN = TOKEN_TYPES[0];
export type AuthKeys =
    'access_token' |
    'id_token' |
    'client_id' |
    'client_secret' |
    'audience' |
    'resource' |
    'code_challenge' |
    'code_challenge_method' |
    'code_verifier' |
    'code' |
    'nonce' |
    'error' |
    'error_description' |
    'error_uri' |
    'expires_in' |
    'grant_type' |
    'password' |
    'redirect_uri' |
    'refresh_token' |
    'response_type' |
    'scope' |
    'state' |
    'token_type' |
    'username' |
    'xError' |
    'xResponseId';
export const PKCE_CHALLENGE_S256 = 'S256';
export const PKCE_CHALLENGE_PLAIN = 'plain';
