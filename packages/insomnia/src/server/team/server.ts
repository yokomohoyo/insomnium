// The team server's HTTP side: /health, the Git repositories at /git, and the
// API at /api, behind sign-in. Plain HTTP: put it behind HTTPS (a reverse
// proxy, such as a NAS's), as Basic sign-in sends the password with each call.
import http from 'node:http';

import { ApiError, handleApi } from './api';
import { gitHandler, gitRoute, reposDir } from './git-http';
import { TeamStore, type User } from './store';

export interface TeamConfig {
  dataDir: string;
  host: string;
  port: number;
  // how clients reach the server, for clone URLs; from the request when unset
  publicUrl?: string;
}

// who a request is from: Basic (name and password or token) or Bearer (a token)
export function signedIn(store: TeamStore, header: string | undefined): User | null {
  if (!header) {
    return null;
  }
  const [scheme, value = ''] = header.split(' ');
  if (/^bearer$/i.test(scheme)) {
    return store.userOfToken(value.trim());
  }
  if (/^basic$/i.test(scheme)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const at = decoded.indexOf(':');
    return at > 0 ? store.authenticate(decoded.slice(0, at), decoded.slice(at + 1)) : null;
  }
  return null;
}

// failed sign-ins from an address: 10 in 5 minutes, then 5 minutes of 429s
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
  const publicUrl = (req: http.IncomingMessage) => {
    if (config.publicUrl) {
      return config.publicUrl.replace(/\/+$/, '');
    }
    // behind a reverse proxy, as it was asked for
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || `${config.host}:${config.port}`).split(',')[0].trim();
    return `${proto}://${host}`;
  };

  const server = http.createServer(async (req, res) => {
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
      const route = gitRoute(url.pathname);
      if (!route && !url.pathname.startsWith('/api/')) {
        return reply(404, { error: 'not found' });
      }
      const address = req.socket.remoteAddress || 'unknown';
      if (limiter.blocked(address)) {
        return reply(429, { error: 'Too many failed sign-ins: wait a few minutes' }, { 'Retry-After': '300' });
      }
      const user = signedIn(store, req.headers.authorization);
      if (!user) {
        if (req.headers.authorization) {
          limiter.failed(address);
        }
        // git asks for credentials when it sees this
        return reply(401, { error: 'Sign in with your user name, and a password or access token' }, { 'WWW-Authenticate': 'Basic realm="Insomnium team", charset="UTF-8"' });
      }
      if (route) {
        return git(req, res, user, route, url.searchParams);
      }
      const [status, body] = await handleApi({ store, dataDir: config.dataDir, publicUrl }, req, user, url.pathname, url.searchParams);
      return reply(status, body);
    } catch (err) {
      if (err instanceof ApiError) {
        return reply(err.status, { error: err.message });
      }
      console.error('[team] request failed:', err);
      return reply(500, { error: 'internal error' });
    }
  });

  return new Promise<{ server: http.Server; store: TeamStore; reposDir: string }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve({ server, store, reposDir: reposDir(config.dataDir) }));
  });
}
