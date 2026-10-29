/**
 * @jest-environment node
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import { teamCollections, teamConnectSso } from '../../main/team-client';
import * as models from '../../models';
import { signJws } from '../../network/jws';
import { parseOidcConfig, pkceChallenge } from '../team/oidc';
import { startTeamServer } from '../team/server';
import type { TeamStore } from '../team/store';

// A provider that signs in whoever `next` names, at once
class FakeProvider {
  server!: http.Server;
  issuer = '';
  next: Record<string, unknown> = {};
  // what the ID token gets wrong, for the checks
  tamper: { nonce?: string; aud?: string; key?: 'other'; iss?: string } = {};
  tokenRequests: URLSearchParams[] = [];
  private codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>();
  private key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

  async start() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', this.issuer);
      const json = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      if (url.pathname === '/.well-known/openid-configuration') {
        return json(200, { issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks` });
      }
      if (url.pathname === '/jwks') {
        return json(200, { keys: [{ ...this.key.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
      }
      if (url.pathname === '/authorize') {
        const code = `code-${this.codes.size}`;
        this.codes.set(code, { nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!, redirectUri: url.searchParams.get('redirect_uri')! });
        const back = new URL(url.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state')!);
        return res.writeHead(302, { Location: back.toString() }).end();
      }
      if (url.pathname === '/token') {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          const params = new URLSearchParams(body);
          this.tokenRequests.push(params);
          const issued = this.codes.get(params.get('code') || '');
          // client_secret_basic: each part form-encoded, then Base64 (RFC 6749 2.3.1)
          const [id, secret] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString('utf8').split(':').map(part => decodeURIComponent(part.replace(/\+/g, ' ')));
          if (id !== 'insomnium' || secret !== 'client secret') {
            return json(401, { error: 'invalid_client' });
          }
          if (!issued || pkceChallenge(params.get('code_verifier') || '') !== issued.challenge || params.get('redirect_uri') !== issued.redirectUri) {
            return json(400, { error: 'invalid_grant' });
          }
          const now = Math.floor(Date.now() / 1000);
          const idToken = signJws({ alg: 'RS256', kid: 'k1' }, {
            iss: this.tamper.iss || this.issuer,
            aud: this.tamper.aud || 'insomnium',
            exp: now + 300,
            iat: now,
            nonce: this.tamper.nonce || issued.nonce,
            ...this.next,
          }, (this.tamper.key === 'other' ? this.otherKey : this.key).privateKey.export({ format: 'pem', type: 'pkcs8' }) as string);
          json(200, { access_token: 'at', token_type: 'Bearer', id_token: idToken });
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
}

// a browser that follows redirects and gives back the last page
async function browse(url: string) {
  let at = url;
  for (let hops = 0; hops < 10; hops++) {
    const response = await fetch(at, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (!location) {
      return { status: response.status, text: await response.text(), url: at };
    }
    at = new URL(location, at).toString();
  }
  throw new Error('too many redirects');
}

describe('single sign-on for the team server', () => {
  const provider = new FakeProvider();
  let dir: string;
  let store: TeamStore;
  let base: string;
  let stop: () => Promise<void>;
  let createUsers = false;

  beforeAll(() => provider.start());
  afterAll(() => new Promise<void>(resolve => provider.server.close(() => resolve())));

  beforeEach(async () => {
    await globalBeforeEach();
    provider.tamper = {};
    provider.tokenRequests = [];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-team-oidc-'));
    const started = await startTeamServer({
      dataDir: dir,
      host: '127.0.0.1',
      port: 0,
      oidc: { issuer: provider.issuer, clientId: 'insomnium', clientSecret: 'client secret', usernameClaim: 'preferred_username', createUsers, name: 'Fake' },
    });
    store = started.store;
    base = `http://127.0.0.1:${(started.server.address() as AddressInfo).port}`;
    stop = () => new Promise(resolve => {
      started.server.close(() => resolve());
      started.server.closeAllConnections();
    });
    store.addUser('kim', 'kims long password');
    store.addCollection('payments', 'Payments', 'kim');
  });
  afterEach(async () => {
    await stop();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
    createUsers = false;
  });

  it('says which sign-ins it takes', async () => {
    expect(await (await fetch(`${base}/auth/methods`)).json()).toEqual({ password: true, sso: { name: 'Fake' } });
  });

  it('signs the app in through the browser, and links the account by subject', async () => {
    provider.next = { sub: 'sub-kim', preferred_username: 'Kim' };

    await expect(teamConnectSso({ url: base }, browse)).resolves.toEqual({ url: base, username: 'kim' });

    const { teamServers } = await models.settings.getOrCreate();
    expect(teamServers).toEqual([expect.objectContaining({ url: base, username: 'kim', token: expect.stringMatching(/^ist_/) })]);
    expect(store.tokens('kim').map(token => token.label)).toEqual([`Insomnium on ${os.hostname()}`]);
    await expect(teamCollections({ url: base, username: 'kim' })).resolves.toEqual([expect.objectContaining({ slug: 'payments' })]);
    // the server's own PKCE with the provider
    expect(provider.tokenRequests[0].get('code_verifier')).toBeTruthy();

    // later, the subject decides, whatever the name claim says
    provider.next = { sub: 'sub-kim', preferred_username: 'someone-else' };
    await expect(teamConnectSso({ url: base }, browse)).resolves.toEqual({ url: base, username: 'kim' });
  });

  it('shows a token once in a browser opened without the app', async () => {
    provider.next = { sub: 'sub-kim', preferred_username: 'kim' };

    const page = await browse(`${base}/auth/oidc/start`);

    expect(page.status).toBe(200);
    const secret = /(ist_[A-Za-z0-9_-]+)/.exec(page.text)?.[1];
    expect(secret).toBeTruthy();
    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${secret}` } });
    expect(await me.json()).toEqual({ name: 'kim', admin: false });
  });

  it("won't sign in someone with no account, unless the server makes them", async () => {
    provider.next = { sub: 'sub-new', preferred_username: 'new-person' };
    const refused = await browse(`${base}/auth/oidc/start`);
    expect(refused.status).toBe(400);
    expect(refused.text).toContain('no account new-person here');
    expect(store.user('new-person')).toBeNull();
  });

  it('makes the account when set to', async () => {
    createUsers = true;
    await stop();
    store.close();
    const started = await startTeamServer({
      dataDir: dir,
      host: '127.0.0.1',
      port: 0,
      oidc: { issuer: provider.issuer, clientId: 'insomnium', clientSecret: 'client secret', usernameClaim: 'email', createUsers: true },
    });
    store = started.store;
    base = `http://127.0.0.1:${(started.server.address() as AddressInfo).port}`;
    stop = () => new Promise(resolve => {
      started.server.close(() => resolve());
      started.server.closeAllConnections();
    });

    provider.next = { sub: 'sub-lee', email: 'lee@example.com', email_verified: false };
    expect((await browse(`${base}/auth/oidc/start`)).text).toContain('not verified your email');

    provider.next = { sub: 'sub-lee', email: 'Lee@example.com', email_verified: true };
    expect((await browse(`${base}/auth/oidc/start`)).status).toBe(200);
    expect(store.user('lee')).toMatchObject({ name: 'lee', admin: false });
    // and no password signs in as them
    expect(store.authenticate('lee', '!')).toBeNull();
  });

  it("won't link an account that another subject already has", async () => {
    provider.next = { sub: 'sub-kim', preferred_username: 'kim' };
    await browse(`${base}/auth/oidc/start`);

    provider.next = { sub: 'sub-impostor', preferred_username: 'kim' };
    const page = await browse(`${base}/auth/oidc/start`);
    expect(page.status).toBe(400);
    expect(page.text).toContain('linked to someone else');
  });

  it.each([
    ['nonce', { nonce: 'another' }, "nonce doesn't match"],
    ['audience', { aud: 'another-client' }, 'for another client'],
    ['signature', { key: 'other' as const }, 'signature is wrong'],
    ['issuer', { iss: 'https://evil.example.com' }, 'from another issuer'],
  ])('refuses an ID token with the wrong %s', async (_, tamper, message) => {
    provider.next = { sub: 'sub-kim', preferred_username: 'kim' };
    provider.tamper = tamper;
    const page = await browse(`${base}/auth/oidc/start`);
    expect(page.status).toBe(400);
    expect(page.text).toContain(message.replace("'", '&#39;'));
    expect(store.tokens('kim')).toEqual([]);
  });

  it('tells the app when the sign-in fails, rather than leave it waiting', async () => {
    provider.next = { sub: 'sub-new', preferred_username: 'new-person' };
    await expect(teamConnectSso({ url: base }, browse)).rejects.toThrow('no account new-person here');
  });

  it('gives the app its token only for the right PKCE verifier, once', async () => {
    provider.next = { sub: 'sub-kim', preferred_username: 'kim' };
    const verifier = 'v'.repeat(43);
    const start = new URL(`${base}/auth/oidc/start`);
    start.searchParams.set('redirect_uri', 'http://127.0.0.1:1/callback');
    start.searchParams.set('state', 'app-state');
    start.searchParams.set('code_challenge', pkceChallenge(verifier));
    // stop at the loopback address, which nothing listens on
    let at = start.toString();
    for (let hops = 0; hops < 5 && !at.startsWith('http://127.0.0.1:1/'); hops++) {
      at = new URL((await fetch(at, { redirect: 'manual' })).headers.get('location') || '', at).toString();
    }
    const back = new URL(at).searchParams;
    expect(back.get('state')).toBe('app-state');
    const exchange = (code_verifier: string) => fetch(`${base}/auth/oidc/token`, { method: 'POST', body: JSON.stringify({ code: back.get('code'), code_verifier, label: 'test' }) });

    expect((await exchange('w'.repeat(43))).status).toBe(400);
    // a wrong verifier used the code up
    expect((await exchange(verifier)).status).toBe(400);
    expect(store.tokens('kim')).toEqual([]);
  });

  it('sends the app back only to a loopback address', async () => {
    const start = new URL(`${base}/auth/oidc/start`);
    start.searchParams.set('redirect_uri', 'https://evil.example.com/callback');
    start.searchParams.set('state', 's');
    start.searchParams.set('code_challenge', pkceChallenge('v'.repeat(43)));
    const page = await browse(start.toString());
    expect(page.status).toBe(400);
    expect(page.text).toContain('loopback address');
  });
});

describe('the single sign-on settings', () => {
  it('are off without an issuer, and need a client id and secret with one', () => {
    expect(parseOidcConfig({})).toBeUndefined();
    expect(() => parseOidcConfig({ INSOMNIUM_TEAM_OIDC_ISSUER: 'https://id.example.com' })).toThrow('CLIENT_ID');
    expect(parseOidcConfig({
      INSOMNIUM_TEAM_OIDC_ISSUER: 'https://id.example.com/application/o/insomnium/',
      INSOMNIUM_TEAM_OIDC_CLIENT_ID: 'insomnium',
      INSOMNIUM_TEAM_OIDC_CLIENT_SECRET: 's',
      INSOMNIUM_TEAM_OIDC_CREATE_USERS: 'true',
    })).toEqual({ issuer: 'https://id.example.com/application/o/insomnium/', clientId: 'insomnium', clientSecret: 's', usernameClaim: 'preferred_username', createUsers: true, name: undefined });
  });
});
