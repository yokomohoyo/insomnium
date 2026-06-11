// Mint a Google OIDC ID token for calling a Cloud Run / IAP-protected service.
//
// Supported credential shapes:
//   - service_account JSON key: sign RS256 JWT, exchange via JWT-bearer grant.
//   - authorized_user (gcloud user creds): refresh-token to access-token, then
//     call iamcredentials:generateIdToken on a target SA. Requires
//     impersonateServiceAccount on the auth strategy.
//   - impersonated_service_account (gcloud --impersonate-service-account):
//     same as above but the target SA comes from the file itself.
//
// Tokens are cached in-memory keyed on (audience, identity) for ~50 minutes.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export type CredentialSource =
  | { kind: 'adc'; impersonateServiceAccount?: string }
  | { kind: 'sa-file'; path: string; impersonateServiceAccount?: string }
  | { kind: 'sa-inline'; json: string; impersonateServiceAccount?: string };

export interface MintOptions {
  source: CredentialSource;
  audience: string;
}

interface ServiceAccountKey {
  type: 'service_account';
  project_id?: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
}

interface AuthorizedUser {
  type: 'authorized_user';
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

interface ImpersonatedServiceAccount {
  type: 'impersonated_service_account';
  service_account_impersonation_url: string;
  source_credentials: ServiceAccountKey | AuthorizedUser;
  delegates?: string[];
}

type AnyCredential = ServiceAccountKey | AuthorizedUser | ImpersonatedServiceAccount;

interface CacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CacheEntry>();
const TOKEN_TTL_MS = 50 * 60 * 1000;

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const IAMCREDENTIALS_HOST = 'iamcredentials.googleapis.com';

export async function getGcpIdToken({ source, audience }: MintOptions): Promise<string> {
  if (!audience) {
    throw new Error('GCP ID token: audience is required');
  }
  const cred = await loadCredential(source);
  // Cache key includes target SA when impersonating so different targets don't collide.
  const targetSa = extractImpersonationTarget(cred, source);
  const identity = targetSa || (cred.type === 'service_account' ? cred.client_email : 'user');
  const cacheKey = `${audience} ${identity}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const token = await mintIdToken(cred, source, audience);
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function _resetGcpIdTokenCache(): void {
  tokenCache.clear();
}

async function loadCredential(source: CredentialSource): Promise<AnyCredential> {
  let raw: string;
  let originDescription: string;
  switch (source.kind) {
    case 'sa-file':
      originDescription = source.path;
      raw = await fs.readFile(source.path, 'utf8');
      break;
    case 'sa-inline':
      originDescription = 'inline JSON';
      raw = source.json;
      break;
    case 'adc': {
      const adcPath = await findAdcPath();
      originDescription = adcPath;
      raw = await fs.readFile(adcPath, 'utf8');
      break;
    }
    default:
      throw new Error(`Unknown credential source: ${(source as { kind: string }).kind}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`GCP ID token: ${originDescription} is not valid JSON: ${(err as Error).message}`);
  }
  switch (parsed.type) {
    case 'service_account':
      if (!parsed.private_key || !parsed.client_email) {
        throw new Error(`GCP ID token: ${originDescription} missing private_key or client_email`);
      }
      return parsed as ServiceAccountKey;
    case 'authorized_user':
      if (!parsed.client_id || !parsed.client_secret || !parsed.refresh_token) {
        throw new Error(`GCP ID token: ${originDescription} missing client_id/client_secret/refresh_token`);
      }
      if (!source.impersonateServiceAccount) {
        throw new Error(
          `GCP ID token: ${originDescription} is authorized_user; set \`impersonateServiceAccount\` ` +
            'on the auth strategy (or re-run `gcloud auth application-default login --impersonate-service-account=...`).',
        );
      }
      return parsed as AuthorizedUser;
    case 'impersonated_service_account':
      if (!parsed.service_account_impersonation_url || !parsed.source_credentials) {
        throw new Error(`GCP ID token: ${originDescription} missing impersonation_url or source_credentials`);
      }
      return parsed as ImpersonatedServiceAccount;
    default:
      throw new Error(
        `GCP ID token: ${originDescription} has unsupported credential type ${JSON.stringify(parsed.type)}; ` +
          'expected service_account, authorized_user, or impersonated_service_account.',
      );
  }
}

function extractImpersonationTarget(cred: AnyCredential, source: CredentialSource): string | null {
  if (cred.type === 'impersonated_service_account') {
    return parseSaEmailFromImpersonationUrl(cred.service_account_impersonation_url);
  }
  return source.impersonateServiceAccount || null;
}

function parseSaEmailFromImpersonationUrl(url: string): string {
  // Format: https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/<email>:generateAccessToken
  const m = url.match(/serviceAccounts\/([^:/]+):/);
  if (!m) throw new Error(`GCP ID token: cannot parse SA email from impersonation URL: ${url}`);
  return m[1];
}

async function findAdcPath(): Promise<string> {
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envPath) {
    return envPath;
  }
  const wellKnown = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'gcloud', 'application_default_credentials.json')
    : path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  try {
    await fs.access(wellKnown);
    return wellKnown;
  } catch {
    throw new Error(
      'GCP ID token: no Application Default Credentials found. ' +
        'Set GOOGLE_APPLICATION_CREDENTIALS or run `gcloud auth application-default login`.',
    );
  }
}

function assertSafeTokenUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`GCP ID token: token_uri is not a valid URL: ${uri}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`GCP ID token: token_uri must use https (got ${parsed.protocol}//${parsed.host})`);
  }
  if (!/(^|\.)googleapis\.com$/i.test(parsed.hostname) && !/(^|\.)google\.com$/i.test(parsed.hostname)) {
    throw new Error(`GCP ID token: token_uri host not allowed: ${parsed.hostname}`);
  }
}

async function mintIdToken(cred: AnyCredential, source: CredentialSource, audience: string): Promise<string> {
  if (cred.type === 'service_account') {
    // If impersonation requested, bridge through iamcredentials.
    if (source.impersonateServiceAccount) {
      const userAccess = await accessTokenFromServiceAccount(cred);
      return idTokenViaImpersonation(userAccess, source.impersonateServiceAccount, audience);
    }
    return idTokenFromServiceAccountDirect(cred, audience);
  }
  if (cred.type === 'authorized_user') {
    const userAccess = await accessTokenFromUser(cred);
    return idTokenViaImpersonation(userAccess, source.impersonateServiceAccount!, audience);
  }
  // impersonated_service_account: chain source creds to access token, then call iamcredentials.
  const targetSa = parseSaEmailFromImpersonationUrl(cred.service_account_impersonation_url);
  const userAccess = cred.source_credentials.type === 'service_account'
    ? await accessTokenFromServiceAccount(cred.source_credentials)
    : await accessTokenFromUser(cred.source_credentials);
  return idTokenViaImpersonation(userAccess, targetSa, audience);
}

// Direct JWT-bearer mint: SA signs assertion with target_audience, exchanges for ID token.
async function idTokenFromServiceAccountDirect(sa: ServiceAccountKey, audience: string): Promise<string> {
  const assertion = buildSignedJwt(sa, audience);
  const tokenUri = sa.token_uri || TOKEN_ENDPOINT;
  assertSafeTokenUri(tokenUri);
  const body = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion });
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GCP ID token: ${tokenUri} returned ${res.status} ${res.statusText}${errText ? `\n${errText}` : ''}`);
  }
  const json = await res.json() as { id_token?: string; error?: string; error_description?: string };
  if (!json.id_token) {
    throw new Error(`GCP ID token: token endpoint returned no id_token (${json.error || 'unknown'}: ${json.error_description || ''})`);
  }
  return json.id_token;
}

// Get a SA access token (no target_audience) so we can call iamcredentials.
async function accessTokenFromServiceAccount(sa: ServiceAccountKey): Promise<string> {
  const assertion = signJwt(sa, { scope: 'https://www.googleapis.com/auth/cloud-platform' });
  const tokenUri = sa.token_uri || TOKEN_ENDPOINT;
  assertSafeTokenUri(tokenUri);
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
  });
  if (!res.ok) {
    throw new Error(`GCP access token (SA): ${res.status} ${res.statusText}: ${await res.text().catch(() => '')}`);
  }
  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new Error('GCP access token (SA): no access_token in response');
  return json.access_token;
}

// Exchange a refresh token for an access token; this is the gcloud user-creds flow.
async function accessTokenFromUser(user: AuthorizedUser): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: user.refresh_token,
    client_id: user.client_id,
    client_secret: user.client_secret,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`GCP access token (user): ${res.status} ${res.statusText}: ${await res.text().catch(() => '')}`);
  }
  const json = await res.json() as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(`GCP access token (user): ${json.error || 'no access_token'}`);
  }
  return json.access_token;
}

// Call iamcredentials.googleapis.com to mint an ID token for a target SA the
// caller has roles/iam.serviceAccountTokenCreator on.
async function idTokenViaImpersonation(userAccessToken: string, targetSaEmail: string, audience: string): Promise<string> {
  const url = `https://${IAMCREDENTIALS_HOST}/v1/projects/-/serviceAccounts/${encodeURIComponent(targetSaEmail)}:generateIdToken`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audience, includeEmail: true }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GCP ID token (impersonate ${targetSaEmail}): ${res.status} ${res.statusText}${errText ? `\n${errText}` : ''}`);
  }
  const json = await res.json() as { token?: string };
  if (!json.token) throw new Error('GCP ID token (impersonate): no token in response');
  return json.token;
}

function buildSignedJwt(sa: ServiceAccountKey, audience: string): string {
  return signJwt(sa, { sub: sa.client_email, target_audience: audience });
}

// RS256 JWT-bearer assertion: standard claims + extras.
function signJwt(sa: ServiceAccountKey, extraClaims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) };
  const payload = {
    iss: sa.client_email,
    aud: sa.token_uri || TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
    ...extraClaims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function defaultAudienceForUrl(url: string): string {
  try {
    const u = new URL(url);
    // Cloud Run / IAP audiences are http(s) origins, even for grpc(s) URLs.
    const protocol = u.protocol === 'grpcs:' ? 'https:'
      : u.protocol === 'grpc:' ? 'http:'
        : u.protocol;
    return `${protocol}//${u.host}`;
  } catch {
    return '';
  }
}
