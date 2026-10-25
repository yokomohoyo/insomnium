/**
 * @jest-environment node
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';
import gitHttp from 'isomorphic-git/http/node';

import { env } from 'node:process';

import { hasGitHttpBackend, runGit } from '../../__jest__/git-server';
import { ensureAdmin, parseTeamConfig, runAdminCommand } from '../team';
import { gitRoute, refChanges, serviceOf } from '../team/git-http';
import { SignInLimiter, signedIn, startTeamServer } from '../team/server';
import { checkPassword, hashPassword, slugOf, TeamStore } from '../team/store';

jest.unmock('isomorphic-git');
// a refused push fails rather than asking for a password
env.GIT_TERMINAL_PROMPT = '0';
// a real Git round trip takes a few seconds
jest.setTimeout(30_000);

// git against the server in this process: runGit's spawnSync would block the
// server it is talking to
const gitAsync = (cwd: string, ...args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn('git', args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  child.on('close', code => (code === 0 ? resolve() : reject(new Error(`git ${args[0]}: ${stderr}`))));
});

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-team-'));

describe('the team store', () => {
  let dir: string;
  let store: TeamStore;
  beforeEach(() => {
    dir = tempDir();
    store = new TeamStore(dir);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps passwords as scrypt hashes and checks them', () => {
    const stored = hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$16384\$/);
    expect(checkPassword('correct horse battery', stored)).toBe(true);
    expect(checkPassword('wrong horse battery', stored)).toBe(false);
  });

  it('signs in with a password or a token, and keeps only the hash of the token', () => {
    store.addUser('kim', 'a long password', true);
    const token = store.addToken('kim', 'laptop');
    expect(store.authenticate('kim', 'a long password')?.name).toBe('kim');
    expect(store.authenticate('kim', token.secret)?.name).toBe('kim');
    expect(store.authenticate('kim', 'nope')).toBeNull();
    expect(store.authenticate('nobody', token.secret)).toBeNull();
    expect(store.userOfToken(token.secret)?.name).toBe('kim');
    expect(JSON.stringify(store.db.prepare('SELECT * FROM tokens').all())).not.toContain(token.secret);
    expect(store.tokens('kim')[0]).toMatchObject({ label: 'laptop', used: expect.any(Number) });
    store.removeToken('kim', token.id);
    expect(store.authenticate('kim', token.secret)).toBeNull();
  });

  it('refuses names that are not names, short passwords, and taking away the last admin', () => {
    expect(() => store.addUser('Kim Smith', 'a long password')).toThrow('lowercase');
    expect(() => store.addUser('../etc', 'a long password')).toThrow();
    expect(() => store.addUser('kim', 'short')).toThrow('10 characters');
    store.addUser('kim', 'a long password', true);
    expect(() => store.setAdmin('kim', false)).toThrow('last admin');
    expect(() => store.removeUser('kim')).toThrow('last admin');
  });

  it('gives each collection roles, an admin owning all, and keeps an owner', () => {
    store.addUser('kim', 'a long password', true);
    store.addUser('lee', 'a long password');
    store.addUser('sam', 'a long password');
    store.addCollection('shop', 'Shop API', 'lee');
    store.setRole('shop', 'sam', 'viewer');
    const lee = store.user('lee')!;
    expect(store.roleOf(lee, 'shop')).toBe('owner');
    expect(store.roleOf(store.user('sam')!, 'shop')).toBe('viewer');
    expect(store.roleOf(store.user('kim')!, 'shop')).toBe('owner');
    expect(store.roleOf(lee, 'other')).toBeNull();
    expect(store.collectionsFor(store.user('sam')!).map(c => [c.slug, c.role])).toEqual([['shop', 'viewer']]);
    expect(() => store.removeMember('shop', 'lee')).toThrow('last owner');
    expect(() => store.setRole('shop', 'sam', 'god' as any)).toThrow('viewer, editor, owner');
    expect(slugOf('Shop API (v2)!')).toBe('shop-api-v2');
  });

  it('keeps an audit log, newest first, by collection, in pages', () => {
    for (let n = 0; n < 5; n++) {
      store.log('kim', 'push', n % 2 ? 'shop' : 'pets', { n });
    }
    const all = store.audit();
    expect(all.map(entry => entry.detail.n)).toEqual([4, 3, 2, 1, 0]);
    expect(store.audit({ collection: 'shop' }).map(entry => entry.detail.n)).toEqual([3, 1]);
    expect(store.audit({ before: all[1].id, limit: 2 }).map(entry => entry.detail.n)).toEqual([2, 1]);
  });

  it('makes the first admin once, and runs the admin commands', () => {
    const printed: string[] = [];
    ensureAdmin(store, { INSOMNIUM_TEAM_ADMIN: 'root' }, text => printed.push(text));
    ensureAdmin(store, {}, text => printed.push(text));
    expect(store.users()).toEqual([expect.objectContaining({ name: 'root', admin: true })]);
    const password = /password (\S+)/.exec(printed[0])![1];
    expect(store.authenticate('root', password)).not.toBeNull();
    // the second start finds an admin, and says nothing
    expect(printed).toHaveLength(1);

    runAdminCommand(store, ['user', 'add', 'kim'], text => printed.push(text));
    const kimPassword = /password: (\S+)/.exec(printed[printed.length - 1])![1];
    expect(store.authenticate('kim', kimPassword)?.admin).toBe(false);
    runAdminCommand(store, ['token', 'kim', 'ci'], text => printed.push(text));
    expect(store.userOfToken(printed[printed.length - 1])?.name).toBe('kim');
    expect(() => runAdminCommand(store, ['nonsense'], () => {})).toThrow('Not a team command');
  });
});

describe('the team server', () => {
  it('reads its options', () => {
    expect(parseTeamConfig(['--data', '/srv/team', '--port', '9000', 'user', 'list'], {})).toMatchObject({ dataDir: '/srv/team', port: 9000, host: '0.0.0.0', command: ['user', 'list'] });
    expect(parseTeamConfig([], { INSOMNIUM_TEAM_DATA: '/x', INSOMNIUM_TEAM_URL: 'https://nas.local' })).toMatchObject({ dataDir: '/x', publicUrl: 'https://nas.local' });
    expect(() => parseTeamConfig(['--public-url', 'nas.local'], {})).toThrow('http(s) URL');
  });

  it('routes Git URLs and tells pushes from fetches', () => {
    expect(gitRoute('/git/shop.git/info/refs')).toEqual({ slug: 'shop', rest: '/info/refs' });
    expect(gitRoute('/git/../etc.git/x')).toBeNull();
    expect(gitRoute('/api/me')).toBeNull();
    expect(serviceOf('/info/refs', new URLSearchParams('service=git-receive-pack'))).toBe('push');
    expect(serviceOf('/git-receive-pack', new URLSearchParams())).toBe('push');
    expect(serviceOf('/git-upload-pack', new URLSearchParams())).toBe('fetch');
    expect(refChanges({ 'refs/heads/main': 'a', 'refs/heads/old': 'b' }, { 'refs/heads/main': 'c', 'refs/heads/new': 'd' })).toEqual([
      { ref: 'refs/heads/main', from: 'a', to: 'c' },
      { ref: 'refs/heads/old', from: 'b', to: null },
      { ref: 'refs/heads/new', from: null, to: 'd' },
    ]);
  });

  it('throttles an address after failed sign-ins', () => {
    let now = 0;
    const limiter = new SignInLimiter(3, 1000, () => now);
    for (let n = 0; n < 3; n++) {
      limiter.failed('10.0.0.5');
    }
    expect(limiter.blocked('10.0.0.5')).toBe(true);
    expect(limiter.blocked('10.0.0.6')).toBe(false);
    now = 2000;
    expect(limiter.blocked('10.0.0.5')).toBe(false);
  });

  describe('over HTTP', () => {
    let dir: string;
    let base: string;
    let stop: () => Promise<void>;
    let store: TeamStore;
    const basic = (name: string, secret: string) => `Basic ${Buffer.from(`${name}:${secret}`).toString('base64')}`;
    const api = async (method: string, route: string, auth: string, body?: unknown) => {
      const res = await fetch(`${base}/api${route}`, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() as any };
    };

    beforeEach(async () => {
      dir = tempDir();
      const started = await startTeamServer({ dataDir: dir, host: '127.0.0.1', port: 0 });
      store = started.store;
      base = `http://127.0.0.1:${(started.server.address() as AddressInfo).port}`;
      // fetch keeps connections open, which close() would wait for
      stop = () => new Promise(resolve => {
        started.server.close(() => resolve());
        started.server.closeAllConnections();
      });
      store.addUser('kim', 'kims long password', true);
      store.addUser('lee', 'lees long password');
      store.addUser('sam', 'sams long password');
    });
    afterEach(async () => {
      await stop();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('answers health checks openly, and nothing else without a sign-in', async () => {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      const res = await fetch(`${base}/api/me`);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/^Basic/);
      expect((await api('GET', '/me', basic('kim', 'wrong password'))).status).toBe(401);
      expect(signedIn(store, basic('kim', 'kims long password'))?.name).toBe('kim');
    });

    it('makes collections, shares them by role, and keeps owners and admins in charge', async () => {
      const lee = basic('lee', 'lees long password');
      const sam = basic('sam', 'sams long password');
      const made = await api('POST', '/collections', lee, { name: 'Shop API' });
      expect(made).toMatchObject({ status: 201, body: { slug: 'shop-api', role: 'owner', cloneUrl: `${base}/git/shop-api.git` } });
      expect(fs.existsSync(path.join(dir, 'repos', 'shop-api.git', 'HEAD'))).toBe(true);
      expect((await api('POST', '/collections', lee, { name: 'Shop API' })).status).toBe(409);

      expect((await api('GET', '/collections', sam)).body).toEqual([]);
      expect((await api('PUT', '/collections/shop-api/members/sam', sam, { role: 'owner' })).status).toBe(404);
      expect((await api('PUT', '/collections/shop-api/members/sam', lee, { role: 'viewer' })).status).toBe(200);
      expect((await api('GET', '/collections', sam)).body).toMatchObject([{ slug: 'shop-api', role: 'viewer' }]);
      expect((await api('PUT', '/collections/shop-api/members/lee', sam, { role: 'viewer' })).status).toBe(403);
      expect((await api('GET', '/collections/shop-api/audit', sam)).status).toBe(403);
      expect((await api('GET', '/collections/shop-api/audit', lee)).body.map((entry: any) => entry.action)).toEqual(['member.set', 'collection.create']);

      // users are an admin's
      expect((await api('POST', '/users', lee, { name: 'max' })).status).toBe(403);
      const max = await api('POST', '/users', basic('kim', 'kims long password'), { name: 'max' });
      expect(max).toMatchObject({ status: 201, body: { name: 'max', password: expect.any(String) } });
      expect(store.authenticate('max', max.body.password)).not.toBeNull();

      // deleting keeps the repository in the trash
      expect((await api('DELETE', '/collections/shop-api', lee)).status).toBe(200);
      expect(fs.readdirSync(path.join(dir, 'trash'))).toEqual([expect.stringMatching(/^shop-api-\d+\.git$/)]);
    });

    it('makes an access token, shown once, which then signs in as a bearer', async () => {
      const made = await api('POST', '/tokens', basic('lee', 'lees long password'), { label: 'laptop' });
      expect(made.body.secret).toMatch(/^ist_/);
      expect((await api('GET', '/me', `Bearer ${made.body.secret}`)).body).toEqual({ name: 'lee', admin: false });
      expect(JSON.stringify((await api('GET', '/tokens', `Bearer ${made.body.secret}`)).body)).not.toContain(made.body.secret);
    });

    (hasGitHttpBackend ? describe : describe.skip)('serving Git', () => {
      it('lets an editor push and a viewer fetch, not push, and logs the push', async () => {
        const lee = basic('lee', 'lees long password');
        await api('POST', '/collections', lee, { name: 'shop' });
        await api('PUT', '/collections/shop/members/sam', lee, { role: 'viewer' });
        const leeToken = store.addToken('lee', 'cli').secret;
        const url = (name: string, secret: string) => `${base.replace('http://', `http://${name}:${encodeURIComponent(secret)}@`)}/git/shop.git`;

        const work = tempDir();
        runGit(work, 'init', '--initial-branch=main', '.');
        fs.writeFileSync(path.join(work, 'a.yml'), 'name: a\n');
        runGit(work, 'add', '.');
        runGit(work, 'commit', '-m', 'first');
        await gitAsync(work, 'push', url('lee', leeToken), 'main');

        // the app's Git Sync client, isomorphic-git, signing in as the viewer
        const clone = tempDir();
        await git.clone({ fs, http: gitHttp, dir: clone, url: `${base}/git/shop.git`, onAuth: () => ({ username: 'sam', password: 'sams long password' }) });
        expect(fs.readFileSync(path.join(clone, 'a.yml'), 'utf8')).toBe('name: a\n');

        fs.writeFileSync(path.join(work, 'b.yml'), 'name: b\n');
        runGit(work, 'add', '.');
        runGit(work, 'commit', '-m', 'second');
        await expect(gitAsync(work, 'push', url('sam', 'sams long password'), 'main')).rejects.toThrow('403');
        // and someone who isn't a member doesn't learn it exists
        const res = await fetch(`${base}/git/shop.git/info/refs?service=git-upload-pack`, { headers: { Authorization: basic('kim', 'wrong one, so 401') } });
        expect(res.status).toBe(401);
        store.addUser('out', 'outsiders password');
        const outsider = await fetch(`${base}/git/shop.git/info/refs?service=git-upload-pack`, { headers: { Authorization: basic('out', 'outsiders password') } });
        expect(outsider.status).toBe(404);

        const pushes = store.audit({ collection: 'shop' }).filter(entry => entry.action === 'push');
        expect(pushes).toEqual([expect.objectContaining({ user: 'lee', detail: { refs: [{ ref: 'refs/heads/main', from: null, to: expect.stringMatching(/^[0-9a-f]{40}$/) }] } })]);
        expect(store.audit({ collection: 'shop' }).some(entry => entry.action === 'fetch' && entry.user === 'sam')).toBe(true);
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(clone, { recursive: true, force: true });
      });
    });
  });
});
