// The team server's HTTP side: /health, the Git repositories at /git, and the
// API at /api, behind sign-in; and single sign-on at /auth (oidc.ts). Basic
// sign-in sends the password with each call, so serve HTTPS: from a reverse proxy
// (such as a NAS's), or itself with a certificate (tls.ts).
import http from 'node:http';

import { createListener, type TlsFiles } from '../tls';

import { ApiError, handleApi, readJson } from './api';
import { gitHandler, gitRoute, reposDir } from './git-http';
import { escapeHtml, OidcError, type OidcConfig, OidcLogin } from './oidc';
import { TeamStore, TOKEN_PREFIX, type User } from './store';

export interface TeamConfig {
  dataDir: string;
  host: string;
  port: number;
  // how clients reach the server, for clone URLs; from the request when unset
  publicUrl?: string;
  // single sign-on with OpenID Connect, when set
  oidc?: OidcConfig;
  // HTTPS from these files, when set
  tls?: TlsFiles;
  // the reverse proxies in front of it, by address: only their X-Forwarded-*
  // headers are believed, for who a request is from and how it was asked for
  trustedProxies?: string[];
}

// what a request signs in with: Basic (name and password or token) or Bearer (a token)
export function credentialsOf(header: string | undefined): { name?: string; secret: string; token: boolean } | null {
  const [scheme, value = ''] = (header || '').split(' ');
  if (/^bearer$/i.test(scheme)) {
    return { secret: value.trim(), token: true };
  }
  if (/^basic$/i.test(scheme)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const at = decoded.indexOf(':');
    const secret = decoded.slice(at + 1);
    return at > 0 ? { name: decoded.slice(0, at), secret, token: secret.startsWith(TOKEN_PREFIX) } : null;
  }
  return null;
}

// who a request is from, and whether it signed in with a token or a password
export async function signedIn(store: TeamStore, header: string | undefined): Promise<{ user: User; token: boolean } | null> {
  const credentials = credentialsOf(header);
  if (!credentials) {
    return null;
  }
  const { name, secret } = credentials;
  const byToken = store.userOfToken(secret, name);
  if (byToken) {
    return { user: byToken, token: true };
  }
  const byPassword = name !== undefined ? await store.userOfPassword(name, secret) : null;
  return byPassword ? { user: byPassword, token: false } : null;
}

const plainAddress = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');

// the address a request came from: the socket's, or, from a trusted proxy,
// the last address before the trusted ones in X-Forwarded-For
export function clientAddress(req: Pick<http.IncomingMessage, 'headers' | 'socket'>, trustedProxies: string[] = []) {
  const trusted = new Set(trustedProxies.map(plainAddress));
  const socket = plainAddress(req.socket.remoteAddress || 'unknown');
  if (!trusted.has(socket)) {
    return socket;
  }
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(hop => plainAddress(hop.trim())).filter(Boolean);
  return forwarded.reverse().find(hop => !trusted.has(hop)) || socket;
}

// failed sign-ins from an address: 10 in 5 minutes, then 5 minutes of 429s
// for its passwords (a token can't be guessed, so still signs in)
export class SignInLimiter {
  private failures = new Map<string, number[]>();

  constructor(private limit = 10, private windowMs = 5 * 60_000, private now = Date.now) {}

  blocked(address: string) {
    const recent = (this.failures.get(address) || []).filter(at => at > this.now() - this.windowMs);
    this.failures.set(address, recent);
    return recent.length >= this.limit;
  }

  failed(address: string) {
    this.failures.set(address, [...(this.failures.get(address) || []), this.now()]);
  }
}

export function startTeamServer(config: TeamConfig) {
  const store = new TeamStore(config.dataDir);
  const git = gitHandler(store, config.dataDir);
  const limiter = new SignInLimiter();
  // single sign-ons started from an address: 30 in 10 minutes
  const ssoStarts = new SignInLimiter(30, 10 * 60_000);
  const oidc = config.oidc ? new OidcLogin(config.oidc, store) : null;
  const fromProxy = (req: http.IncomingMessage) => (config.trustedProxies || []).map(plainAddress).includes(plainAddress(req.socket.remoteAddress || ''));
  const publicUrl = (req: http.IncomingMessage) => {
    if (config.publicUrl) {
      return config.publicUrl.replace(/\/+$/, '');
    }
    // behind a trusted reverse proxy, as it was asked for
    const forwarded = (name: string) => (fromProxy(req) && req.headers[name] ? String(req.headers[name]).split(',')[0].trim() : '');
    const proto = forwarded('x-forwarded-proto') || (config.tls ? 'https' : 'http');
    const host = forwarded('x-forwarded-host') || req.headers.host || `${config.host}:${config.port}`;
    return `${proto}://${host}`;
  };

  const server = createListener(async (req, res) => {
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
      }
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') {
        return reply(200, { ok: true });
      }
      const address = clientAddress(req, config.trustedProxies);
      if (url.pathname.startsWith('/auth/')) {
        return await handleAuth(req, res, url, reply, address);
      }
      const route = gitRoute(url.pathname);
      if (!route && !url.pathname.startsWith('/api/')) {
        return reply(404, { error: 'not found' });
      }
      const tooMany = () => reply(429, { error: 'Too many failed sign-ins: wait a few minutes' }, { 'Retry-After': '300' });
      // a password from an address that's been guessing waits; a token doesn't
      if (limiter.blocked(address) && !credentialsOf(req.headers.authorization)?.token) {
        return tooMany();
      }
      const signIn = await signedIn(store, req.headers.authorization);
      if (!signIn) {
        if (req.headers.authorization) {
          limiter.failed(address);
        }
        // git asks for credentials when it sees this
        return reply(401, { error: 'Sign in with your user name, and a password or access token' }, { 'WWW-Authenticate': 'Basic realm="Insomnium team", charset="UTF-8"' });
      }
      if (route) {
        return git(req, res, signIn.user, route, url.searchParams);
      }
      const signInFailed = () => {
        limiter.failed(address);
        return limiter.blocked(address);
      };
      const [status, body] = await handleApi({ store, dataDir: config.dataDir, publicUrl, byToken: signIn.token, signInFailed }, req, signIn.user, url.pathname, url.searchParams);
      return reply(status, body);
    } catch (err) {
      if (err instanceof ApiError) {
        return reply(err.status, { error: err.message });
      }
      console.error('[team] request failed:', err);
      return reply(500, { error: 'internal error' });
    }
  }, config.tls);

  async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, url: URL, reply: (status: number, body: unknown, headers?: Record<string, string>) => void, address: string) {
    const page = (status: number, title: string, body: string) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Referrer-Policy': 'no-referrer',
      });
      res.end(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 40rem"><h1>${escapeHtml(title)}</h1>${body}</body>`);
    };
    const callbackUrl = (request: http.IncomingMessage) => `${publicUrl(request)}/auth/oidc/callback`;
    if (url.pathname === '/auth/methods' && req.method === 'GET') {
      return reply(200, { password: true, sso: oidc ? { name: oidc.config.name || 'single sign-on' } : null });
    }
    if (!oidc) {
      return reply(404, { error: "This server has no single sign-on set up" });
    }
    try {
      if (url.pathname === '/auth/oidc/start' && req.method === 'GET') {
        if (ssoStarts.blocked(address)) {
          return reply(429, { error: 'Too many sign-ins started: wait a few minutes' }, { 'Retry-After': '600' });
        }
        ssoStarts.failed(address);
        const redirectUri = url.searchParams.get('redirect_uri');
        const app = redirectUri ? {
          redirectUri,
          state: url.searchParams.get('state') || '',
          challenge: url.searchParams.get('code_challenge') || '',
        } : undefined;
        res.writeHead(302, { Location: await oidc.start(callbackUrl(req), app), 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (url.pathname === '/auth/oidc/callback' && req.method === 'GET') {
        const { user, app } = await oidc.callback(url.searchParams);
        if (app) {
          res.writeHead(302, { Location: app.redirect, 'Cache-Control': 'no-store' });
          return res.end();
        }
        // opened in a browser: a token for git, shown once
        const token = store.addToken(user.name, 'Browser sign-in');
        store.log(user.name, 'token.create', null, { id: token.id, label: 'Browser sign-in', sso: true });
        return page(200, `Signed in as ${user.name}`, `<p>Your new access token, shown only this once. Use it as the password when git asks, with the user name <b>${escapeHtml(user.name)}</b>:</p><pre style="padding: 1rem; background: #eee; overflow-wrap: anywhere; white-space: pre-wrap">${escapeHtml(token.secret)}</pre><p>In Insomnium, sign in with single sign-on from the Team Server tab instead.</p>`);
      }
      if (url.pathname === '/auth/oidc/token' && req.method === 'POST') {
        const { code, code_verifier, label } = await readJson(req);
        return reply(200, oidc.exchange(String(code || ''), String(code_verifier || ''), typeof label === 'string' ? label : 'token'));
      }
    } catch (err) {
      if (err instanceof OidcError) {
        console.warn('[team] single sign-on failed:', err.message);
        if (err.appRedirect) {
          res.writeHead(302, { Location: err.appRedirect, 'Cache-Control': 'no-store' });
          return res.end();
        }
        return url.pathname === '/auth/oidc/token'
          ? reply(400, { error: err.message })
          : page(400, "Couldn't sign in", `<p>${escapeHtml(err.message)}</p>`);
      }
      throw err;
    }
    return reply(404, { error: 'not found' });
  }

  return new Promise<{ server: http.Server; store: TeamStore; reposDir: string }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve({ server, store, reposDir: reposDir(config.dataDir) }));
  });
}
