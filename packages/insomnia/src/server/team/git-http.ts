// The team's collections over Git's smart HTTP protocol, at
// /git/<slug>.git: git's own http-backend does the protocol, behind sign-in.
// Fetching needs viewer, pushing editor. A push is logged with the refs it
// moved; fetches at most every few minutes per user and collection.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { env } from 'node:process';

import { atLeast, type TeamStore, type User } from './store';

export const reposDir = (dataDir: string) => path.join(dataDir, 'repos');
export const repoPath = (dataDir: string, slug: string) => path.join(reposDir(dataDir), `${slug}.git`);

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

// a new, empty repository for a collection, on the main branch
export function initRepo(dataDir: string, slug: string) {
  const dir = repoPath(dataDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const result = git(dir, 'init', '--bare', '--initial-branch=main', '.');
  if (result.status !== 0) {
    throw new Error(`git init failed: ${result.stderr}`);
  }
  // pushes over HTTP, for a signed-in editor; history kept even after a force push
  git(dir, 'config', 'http.receivepack', 'true');
  git(dir, 'config', 'core.logAllRefUpdates', 'true');
}

// the refs a repository has, by name
const refsOf = (dir: string): Record<string, string> => Object.fromEntries(git(dir, 'for-each-ref', '--format=%(objectname) %(refname)').stdout
  .split('\n').filter(Boolean).map(line => line.split(' ')).map(([oid, ref]) => [ref, oid]));

// what a push changed: each ref's old and new commit (null when made or deleted)
export const refChanges = (before: Record<string, string>, after: Record<string, string>) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(ref => before[ref] !== after[ref])
    .map(ref => ({ ref, from: before[ref] ?? null, to: after[ref] ?? null }));

// /git/<slug>.git/<rest>: the slug and the rest, or null
export function gitRoute(pathname: string) {
  const match = /^\/git\/([a-z0-9][a-z0-9._-]{0,63})\.git(\/.*)?$/.exec(pathname);
  return match ? { slug: match[1], rest: match[2] || '/' } : null;
}

// what a request does: push (receive-pack) or fetch (upload-pack, or the dumb protocol's files)
export function serviceOf(rest: string, search: URLSearchParams) {
  if (rest === '/git-receive-pack' || (rest === '/info/refs' && search.get('service') === 'git-receive-pack')) {
    return 'push';
  }
  return 'fetch';
}

const FETCH_LOG_EVERY = 10 * 60_000;

export function gitHandler(store: TeamStore, dataDir: string) {
  const lastFetchLogged = new Map<string, number>();

  return (req: http.IncomingMessage, res: http.ServerResponse, user: User, route: { slug: string; rest: string }, search: URLSearchParams) => {
    const service = serviceOf(route.rest, search);
    const role = store.roleOf(user, route.slug);
    if (!atLeast(role, service === 'push' ? 'editor' : 'viewer')) {
      res.writeHead(role ? 403 : 404, { 'Content-Type': 'text/plain' });
      res.end(role ? `${user.name} can't push to ${route.slug}: editors and owners can\n` : 'Not found\n');
      return;
    }
    const dir = repoPath(dataDir, route.slug);
    // the push's effect, read from the refs before and after
    const pushing = service === 'push' && req.method === 'POST';
    const before = pushing ? refsOf(dir) : {};

    const cgi = spawn('git', ['http-backend'], {
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        GIT_PROJECT_ROOT: reposDir(dataDir),
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${route.slug}.git${route.rest}`,
        QUERY_STRING: search.toString(),
        REQUEST_METHOD: req.method || 'GET',
        CONTENT_TYPE: req.headers['content-type'] || '',
        CONTENT_LENGTH: req.headers['content-length'] || '',
        HTTP_CONTENT_ENCODING: String(req.headers['content-encoding'] || ''),
        GIT_PROTOCOL: String(req.headers['git-protocol'] || ''),
        REMOTE_USER: user.name,
        REMOTE_ADDR: req.socket.remoteAddress || '',
      },
    });
    req.pipe(cgi.stdin);
    cgi.stdin.on('error', () => {});

    // http-backend writes CGI headers, then the body
    let head = Buffer.alloc(0);
    let started = false;
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (started) {
        res.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) {
        return;
      }
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const at = line.indexOf(':');
        const name = line.slice(0, at).trim();
        const value = line.slice(at + 1).trim();
        if (name.toLowerCase() === 'status') {
          status = parseInt(value, 10) || 500;
        } else if (name) {
          headers[name] = value;
        }
      }
      res.writeHead(status, headers);
      started = true;
      res.write(head.subarray(end + 4));
    });
    cgi.stderr.on('data', chunk => console.error(`[team] git ${route.slug}: ${String(chunk).trim()}`));
    cgi.on('close', () => {
      if (!started) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('git http-backend failed\n');
        return;
      }
      res.end();
      if (pushing) {
        const changes = refChanges(before, refsOf(dir));
        if (changes.length) {
          store.log(user.name, 'push', route.slug, { refs: changes });
        }
      } else if (req.method === 'POST') {
        const key = `${user.name}\0${route.slug}`;
        const now = Date.now();
        if ((lastFetchLogged.get(key) ?? 0) + FETCH_LOG_EVERY <= now) {
          lastFetchLogged.set(key, now);
          store.log(user.name, 'fetch', route.slug);
        }
      }
    });
  };
}
