// The app's side of a team server (`insomnium-server team`, server/team): sign
// in, list the collections you can use, and start new ones. Signing in with a
// password makes an access token for this computer, and only the token is
// kept (Settings.teamServers, encrypted at rest). Calls go through the app's
// proxy and certificate settings, from the main process, as the server sends
// no CORS headers.
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';

import type { TeamServerSignIn } from '../common/settings';
import { normalizeTeamUrl, onServer, type TeamCollection, type TeamServerKey } from '../common/team-server';
import * as models from '../models';
import { authorizeInSystemBrowser } from './authorize-in-system-browser';
import { axiosRequest } from './network/axios-request';

const TIMEOUT_MS = 30_000;
const TOKEN_PREFIX = 'ist_';

const basic = (username: string, secret: string) => `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;

async function call<T>(url: string, authorization: string | null, method: string, path: string, data?: unknown): Promise<T> {
  let response;
  try {
    response = await axiosRequest({
      method,
      // /auth/… is the sign-in itself; everything else is the API
      url: path.startsWith('/') ? `${url}${path}` : `${url}/api/${path}`,
      headers: { ...(authorization ? { Authorization: authorization } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
      data,
      timeout: TIMEOUT_MS,
      responseType: 'json',
      validateStatus: () => true,
    });
  } catch (err) {
    throw new Error(`Couldn't reach ${url}: ${(err as Error).message}`);
  }
  if (response.status === 401) {
    throw new Error(`${url} didn't accept the user name and password or token`);
  }
  if (response.status >= 400) {
    const detail = typeof response.data?.error === 'string' ? response.data.error : '';
    throw new Error(`${url} answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!response.data || typeof response.data !== 'object') {
    throw new Error(`${url} doesn't look like an Insomnium team server`);
  }
  return response.data as T;
}

const sameServer = (a: TeamServerKey) => (b: TeamServerKey) => a.url === b.url && a.username === b.username;

async function signInFor(key: TeamServerKey) {
  const settings = await models.settings.getOrCreate();
  const signIn = (settings.teamServers || []).find(sameServer(key));
  if (!signIn) {
    throw new Error(`Sign in to ${key.url} first`);
  }
  return signIn;
}

export async function teamConnect(options: TeamServerKey & { password: string }): Promise<TeamServerKey> {
  const url = normalizeTeamUrl(options.url);
  const username = options.username.trim();
  if (!username || !options.password) {
    throw new Error('Enter your user name, and a password or access token');
  }
  const me = await call<{ name?: string }>(url, basic(username, options.password), 'GET', 'me');
  if (typeof me.name !== 'string') {
    throw new Error(`${url} doesn't look like an Insomnium team server`);
  }
  // a token as it is; a password traded for a token of this computer's
  const signIn: TeamServerSignIn = options.password.startsWith(TOKEN_PREFIX)
    ? { url, username: me.name, token: options.password, tokenId: '' }
    : await call<{ id: string; secret: string }>(url, basic(username, options.password), 'POST', 'tokens', { label: `Insomnium on ${os.hostname()}` })
      .then(token => ({ url, username: me.name as string, token: token.secret, tokenId: token.id }));
  return keep(signIn);
}

async function keep(signIn: TeamServerSignIn): Promise<TeamServerKey> {
  const settings = await models.settings.getOrCreate();
  const others = (settings.teamServers || []).filter(server => !sameServer(signIn)(server));
  await models.settings.update(settings, { teamServers: [...others, signIn] });
  return { url: signIn.url, username: signIn.username };
}

// single sign-on (server/team/oidc.ts): the provider's page in the system
// browser, then a one-time code on a loopback address, traded for a token
export async function teamConnectSso(options: { url: string }, open?: (url: string) => Promise<unknown>): Promise<TeamServerKey> {
  const url = normalizeTeamUrl(options.url);
  const methods = await call<{ sso?: { name: string } | null }>(url, null, 'GET', '/auth/methods');
  if (!methods.sso) {
    throw new Error(`${url} has no single sign-on set up: sign in with a password or token`);
  }
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const start = new URL(`${url}/auth/oidc/start`);
  start.searchParams.set('state', state);
  start.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  const { redirectedTo } = await authorizeInSystemBrowser({ url: start.toString(), redirectUrl: 'http://127.0.0.1/callback' }, open);
  const back = new URL(redirectedTo).searchParams;
  if (back.get('state') !== state) {
    throw new Error('The sign-in came back for another request: try again');
  }
  if (!back.get('code')) {
    throw new Error(`Single sign-on failed${back.get('error') ? `: ${back.get('error_description') || back.get('error')}` : ''}`);
  }
  const token = await call<{ username: string; id: string; secret: string }>(url, null, 'POST', '/auth/oidc/token', {
    code: back.get('code'),
    code_verifier: verifier,
    label: `Insomnium on ${os.hostname()}`,
  });
  return keep({ url, username: token.username, token: token.secret, tokenId: token.id });
}

// forgets the sign-in, and revokes the token it made (if the server can be reached)
export async function teamDisconnect(key: TeamServerKey) {
  const settings = await models.settings.getOrCreate();
  const signIn = (settings.teamServers || []).find(sameServer(key));
  if (signIn?.tokenId) {
    await call(signIn.url, basic(signIn.username, signIn.token), 'DELETE', `tokens/${encodeURIComponent(signIn.tokenId)}`)
      .catch(err => console.warn('[team] Could not revoke the token', err));
  }
  await models.settings.update(settings, { teamServers: (settings.teamServers || []).filter(server => !sameServer(key)(server)) });
}

export async function teamCollections(key: TeamServerKey): Promise<TeamCollection[]> {
  const signIn = await signInFor(key);
  const collections = await call<TeamCollection[]>(signIn.url, basic(signIn.username, signIn.token), 'GET', 'collections');
  if (!Array.isArray(collections)) {
    throw new Error(`${signIn.url} doesn't look like an Insomnium team server`);
  }
  // the token goes with each clone and push: only to the server it's for
  return collections.map(collection => ({ ...collection, cloneUrl: onServer(signIn.url, collection) }));
}

export async function teamCreateCollection(options: TeamServerKey & { name: string }): Promise<TeamCollection> {
  const signIn = await signInFor(options);
  return call<TeamCollection>(signIn.url, basic(signIn.username, signIn.token), 'POST', 'collections', { name: options.name.trim() });
}

export interface TeamBridgeAPI {
  connect: typeof teamConnect;
  connectSso: (options: { url: string }) => Promise<TeamServerKey>;
  disconnect: typeof teamDisconnect;
  collections: typeof teamCollections;
  create: typeof teamCreateCollection;
}
