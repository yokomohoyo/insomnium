// Single sign-on for the team server with OpenID Connect: Authentik, Keycloak,
// Authelia, Entra ID, Google, Okta and others. The server is a confidential
// client using the authorization code flow with PKCE; it checks the ID token's
// signature against the provider's keys, and its issuer, audience, expiry and
// nonce. Someone signed in this way is linked to an account by the provider's
// subject id: on first sign-in, to the account named by a claim
// (preferred_username unless set), if it isn't linked to someone else yet, or
// to a new account when the server makes them.
//
// The app (main/team-client.ts) starts at /auth/oidc/start with a loopback
// redirect_uri and a PKCE challenge of its own; after the provider, the server
// sends it a one-time code, which it trades at /auth/oidc/token for an access
// token. Opened in a browser without one, the server shows a new token once,
// for git on the command line.
import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey, constants, timingSafeEqual } from 'node:crypto';

import { isName, type TeamStore, type User } from './store';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  // the claim that names the account on first sign-in
  usernameClaim: string;
  // with the email claim, the domains whose addresses may sign in: the part
  // before the @ names the account, so another domain's lee is not ours
  emailDomains?: string[];
  // make an account for someone the provider signed in who has none
  createUsers: boolean;
  // what the sign-in button says: "Sign in with Authentik"
  name?: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Pending {
  nonce: string;
  verifier: string;
  created: number;
  // the redirect_uri given the provider, which the token request repeats
  callbackUrl: string;
  // the app's loopback address, state and PKCE challenge; none in a browser
  app?: { redirectUri: string; state: string; challenge: string };
}

interface Handoff {
  user: string;
  challenge: string;
  created: number;
}

const PENDING_MS = 10 * 60_000;
const HANDOFF_MS = 2 * 60_000;
const DISCOVERY_MS = 60 * 60_000;
const CLOCK_SKEW_S = 120;
const MAX_PENDING = 1000;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const random = () => randomBytes(32).toString('base64url');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

export class OidcError extends Error {
  // a failed sign-in the app started: its loopback address, with the error, so it stops waiting
  appRedirect?: string;
}

// an RS*, PS* or ES* JWS signature checked with a JWK
export function verifyJws(token: string, findKey: (header: Record<string, unknown>) => JsonWebKey | undefined): Record<string, any> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new OidcError('The ID token is not a JWT');
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  let header: Record<string, unknown>;
  let claims: Record<string, any>;
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw new OidcError('The ID token is not a JWT');
  }
  const algorithm = String(header.alg);
  const match = /^(RS|PS|ES)(256|384|512)$/.exec(algorithm);
  if (!match) {
    throw new OidcError(`The ID token is signed with ${algorithm}, which the team server doesn't take`);
  }
  const jwk = findKey(header);
  if (!jwk) {
    throw new OidcError('The provider has no key for the ID token');
  }
  const [, family, bits] = match;
  if ((family === 'ES' && jwk.kty !== 'EC') || (family !== 'ES' && jwk.kty !== 'RSA')) {
    throw new OidcError(`The provider's key doesn't fit ${algorithm}`);
  }
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const input = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = Buffer.from(signaturePart, 'base64url');
  const ok = verifySignature(`sha${bits}`, input, family === 'ES'
    ? { key, dsaEncoding: 'ieee-p1363' }
    : family === 'PS'
      ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }
      : key, signature);
  if (!ok) {
    throw new OidcError("The ID token's signature is wrong");
  }
  return claims;
}

export class OidcLogin {
  private pending = new Map<string, Pending>();
  private handoffs = new Map<string, Handoff>();
  private discovery: { value: Discovery; at: number } | null = null;
  private keys: { value: JsonWebKey[]; at: number } | null = null;

  constructor(
    readonly config: OidcConfig,
    private store: TeamStore,
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}

  private async json(url: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new OidcError(`Couldn't reach the provider at ${new URL(url).origin}: ${(err as Error).message}`);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== 'object') {
      const detail = body && typeof body.error === 'string' ? `: ${body.error}${body.error_description ? ` (${body.error_description})` : ''}` : '';
      throw new OidcError(`The provider answered ${response.status}${detail}`);
    }
    return body as Record<string, any>;
  }

  private async discover(): Promise<Discovery> {
    if (this.discovery && this.now() - this.discovery.at < DISCOVERY_MS) {
      return this.discovery.value;
    }
    const issuer = this.config.issuer.replace(/\/+$/, '');
    const value = await this.json(`${issuer}/.well-known/openid-configuration`) as Discovery;
    // the issuer must be the one configured, so another provider can't stand in
    if (value.issuer?.replace(/\/+$/, '') !== issuer) {
      throw new OidcError(`The provider says it is ${value.issuer}, not ${this.config.issuer}`);
    }
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      if (typeof value[field] !== 'string' || !/^https?:\/\//.test(value[field])) {
        throw new OidcError(`The provider's configuration has no ${field}`);
      }
    }
    this.discovery = { value, at: this.now() };
    return value;
  }

  private async signingKeys(refresh: boolean) {
    if (!refresh && this.keys && this.now() - this.keys.at < DISCOVERY_MS) {
      return this.keys.value;
    }
    const { jwks_uri } = await this.discover();
    const { keys } = await this.json(jwks_uri);
    this.keys = { value: Array.isArray(keys) ? keys : [], at: this.now() };
    return this.keys.value;
  }

  private prune() {
    for (const [key, value] of this.pending) {
      if (this.now() - value.created > PENDING_MS) {
        this.pending.delete(key);
      }
    }
    for (const [key, value] of this.handoffs) {
      if (this.now() - value.created > HANDOFF_MS) {
        this.handoffs.delete(key);
      }
    }
  }

  // where to send the browser: the provider's sign-in page
  async start(callbackUrl: string, app?: { redirectUri: string; state: string; challenge: string }) {
    if (app) {
      let redirect: URL;
      try {
        redirect = new URL(app.redirectUri);
      } catch {
        throw new OidcError('redirect_uri is not a URL');
      }
      // only to the app on the computer the browser is on
      if (redirect.protocol !== 'http:' || !LOOPBACK.has(redirect.hostname)) {
        throw new OidcError('redirect_uri has to be a loopback address, such as http://127.0.0.1:5000/callback');
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(app.challenge)) {
        throw new OidcError('code_challenge has to be an S256 PKCE challenge');
      }
    }
    this.prune();
    if (this.pending.size >= MAX_PENDING) {
      throw new OidcError('Too many sign-ins under way: try again in a few minutes');
    }
    const { authorization_endpoint } = await this.discover();
    const state = random();
    const pending: Pending = { nonce: random(), verifier: random(), created: this.now(), callbackUrl, app };
    this.pending.set(state, pending);
    const url = new URL(authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', pending.nonce);
    url.searchParams.set('code_challenge', pkceChallenge(pending.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  // the provider's redirect back: the account it signed in, and where the browser goes next
  async callback(params: URLSearchParams): Promise<{ user: User; app?: { redirect: string } }> {
    const state = params.get('state') || '';
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || this.now() - pending.created > PENDING_MS) {
      throw new OidcError('This sign-in has expired or was already used: start again');
    }
    try {
      return await this.finish(pending, params);
    } catch (err) {
      if (err instanceof OidcError && pending.app) {
        const redirect = new URL(pending.app.redirectUri);
        redirect.searchParams.set('error', 'access_denied');
        redirect.searchParams.set('error_description', err.message);
        redirect.searchParams.set('state', pending.app.state);
        err.appRedirect = redirect.toString();
      }
      throw err;
    }
  }

  private async finish(pending: Pending, params: URLSearchParams): Promise<{ user: User; app?: { redirect: string } }> {
    const providerError = params.get('error');
    if (providerError) {
      throw new OidcError(`The provider refused: ${providerError}${params.get('error_description') ? ` (${params.get('error_description')})` : ''}`);
    }
    const code = params.get('code');
    if (!code) {
      throw new OidcError('The provider sent no code');
    }
    const { token_endpoint } = await this.discover();
    const tokens = await this.json(token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: pending.callbackUrl, code_verifier: pending.verifier }).toString(),
    });
    if (typeof tokens.id_token !== 'string') {
      throw new OidcError('The provider sent no ID token: is the openid scope allowed for this client?');
    }
    const claims = await this.checkIdToken(tokens.id_token, pending.nonce);
    const user = this.accountFor(claims);
    if (!pending.app) {
      return { user };
    }
    const handoff = random();
    this.handoffs.set(handoff, { user: user.name, challenge: pending.app.challenge, created: this.now() });
    const redirect = new URL(pending.app.redirectUri);
    redirect.searchParams.set('code', handoff);
    redirect.searchParams.set('state', pending.app.state);
    return { user, app: { redirect: redirect.toString() } };
  }

  private async checkIdToken(idToken: string, nonce: string) {
    const find = (keys: JsonWebKey[]) => (header: Record<string, unknown>) => {
      const usable = keys.filter(key => !key.use || key.use === 'sig');
      return header.kid ? usable.find(key => key.kid === header.kid) : usable.length === 1 ? usable[0] : undefined;
    };
    let claims: Record<string, any>;
    try {
      claims = verifyJws(idToken, find(await this.signingKeys(false)));
    } catch (err) {
      // a new key the cached set doesn't have yet
      if (!(err instanceof OidcError) || !/no key/.test(err.message)) {
        throw err;
      }
      claims = verifyJws(idToken, find(await this.signingKeys(true)));
    }
    const { issuer } = await this.discover();
    const now = Math.floor(this.now() / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer) {
      throw new OidcError('The ID token is from another issuer');
    }
    if (!audience.includes(this.config.clientId) || (audience.length > 1 && claims.azp !== undefined && claims.azp !== this.config.clientId)) {
      throw new OidcError('The ID token is for another client');
    }
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) {
      throw new OidcError('The ID token has expired: check the server clock');
    }
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) {
      throw new OidcError('The ID token is from the future: check the server clock');
    }
    if (typeof claims.nonce !== 'string' || !sameText(claims.nonce, nonce)) {
      throw new OidcError("The ID token's nonce doesn't match this sign-in");
    }
    if (typeof claims.sub !== 'string' || !claims.sub) {
      throw new OidcError('The ID token has no subject');
    }
    return claims;
  }

  private accountFor(claims: Record<string, any>): User {
    const { issuer } = this.discovery!.value;
    const linked = this.store.userOfIdentity(issuer, claims.sub);
    if (linked) {
      return linked;
    }
    const raw = claims[this.config.usernameClaim];
    if (typeof raw !== 'string' || !raw) {
      throw new OidcError(`The provider didn't send the ${this.config.usernameClaim} claim, which names your account`);
    }
    let name = raw.toLowerCase();
    if (this.config.usernameClaim === 'email') {
      if (claims.email_verified !== true) {
        throw new OidcError('The provider has not verified your email address');
      }
      // an email names the account by the part before the @, so only addresses
      // at the server's own domains may
      const at = name.lastIndexOf('@');
      if (at < 1 || !this.config.emailDomains?.includes(name.slice(at + 1))) {
        throw new OidcError(`${raw} isn't at a domain this server takes: ask an admin`);
      }
      name = name.slice(0, at);
    }
    if (!isName(name)) {
      throw new OidcError(`${name} can't be a user name here: ask an admin`);
    }
    const existing = this.store.user(name);
    if (existing) {
      // a first sign-in claims an account by its name alone, so never an admin's
      if (existing.admin) {
        throw new OidcError(`The account ${name} is an admin's, which single sign-on can't claim: sign in with its password`);
      }
      if (this.store.identityOf(name, issuer)) {
        throw new OidcError(`The account ${name} is linked to someone else at the provider: ask an admin`);
      }
      this.store.linkIdentity(issuer, claims.sub, name);
      this.store.log(name, 'user.link', null, { issuer });
      return existing;
    }
    if (!this.config.createUsers) {
      throw new OidcError(`There's no account ${name} here: ask an admin to add it`);
    }
    this.store.addSsoUser(name);
    this.store.linkIdentity(issuer, claims.sub, name);
    this.store.log(name, 'user.create', null, { user: name, sso: issuer });
    return this.store.user(name)!;
  }

  // the app trades its one-time code (and PKCE verifier) for an access token
  exchange(code: string, verifier: string, label: string) {
    this.prune();
    const handoff = this.handoffs.get(code);
    this.handoffs.delete(code);
    if (!handoff || !verifier || !sameText(pkceChallenge(verifier), handoff.challenge)) {
      throw new OidcError('That sign-in code is wrong, used or expired: sign in again');
    }
    const token = this.store.addToken(handoff.user, label);
    this.store.log(handoff.user, 'token.create', null, { id: token.id, label, sso: true });
    return { username: handoff.user, ...token };
  }
}

export function parseOidcConfig(env: NodeJS.ProcessEnv): OidcConfig | undefined {
  const issuer = env.INSOMNIUM_TEAM_OIDC_ISSUER?.trim();
  if (!issuer) {
    return undefined;
  }
  if (!/^https?:\/\/[^/]+/.test(issuer)) {
    throw new Error('INSOMNIUM_TEAM_OIDC_ISSUER is the provider\'s https:// issuer URL');
  }
  const clientId = env.INSOMNIUM_TEAM_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.INSOMNIUM_TEAM_OIDC_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('Single sign-on needs INSOMNIUM_TEAM_OIDC_CLIENT_ID and INSOMNIUM_TEAM_OIDC_CLIENT_SECRET too');
  }
  const usernameClaim = env.INSOMNIUM_TEAM_OIDC_USERNAME_CLAIM?.trim() || 'preferred_username';
  const emailDomains = (env.INSOMNIUM_TEAM_OIDC_EMAIL_DOMAINS || '').split(',').map(domain => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (usernameClaim === 'email' && !emailDomains.length) {
    throw new Error('With the email claim, set INSOMNIUM_TEAM_OIDC_EMAIL_DOMAINS to the domains whose addresses may sign in, such as example.com');
  }
  return {
    issuer,
    clientId,
    clientSecret,
    usernameClaim,
    ...(emailDomains.length ? { emailDomains } : {}),
    createUsers: /^(1|true|yes|on)$/i.test(env.INSOMNIUM_TEAM_OIDC_CREATE_USERS || ''),
    name: env.INSOMNIUM_TEAM_OIDC_NAME?.trim() || undefined,
  };
}
