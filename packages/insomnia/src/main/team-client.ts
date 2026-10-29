// The app's side of a team server (`insomnium-server team`, server/team): sign
// in, list the collections you can use, and start new ones. Signing in with a
// password makes an access token for this computer, and only the token is
// kept (Settings.teamServers, encrypted at rest). Calls go through the app's
// proxy and certificate settings, from the main process, as the server sends
// no CORS headers.
import os from 'node:os';

import type { TeamServerSignIn } from '../common/settings';
import { normalizeTeamUrl, type TeamCollection, type TeamServerKey } from '../common/team-server';
import * as models from '../models';
import { axiosRequest } from './network/axios-request';

const TIMEOUT_MS = 30_000;
const TOKEN_PREFIX = 'ist_';

const basic = (username: string, secret: string) => `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;

async function call<T>(url: string, authorization: string, method: string, path: string, data?: unknown): Promise<T> {
  let response;
  try {
    response = await axiosRequest({
      method,
      url: `${url}/api/${path}`,
      headers: { Authorization: authorization, ...(data ? { 'Content-Type': 'application/json' } : {}) },
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
  const settings = await models.settings.getOrCreate();
  const others = (settings.teamServers || []).filter(server => !sameServer(signIn)(server));
  await models.settings.update(settings, { teamServers: [...others, signIn] });
  return { url, username: signIn.username };
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
  return collections;
}

export async function teamCreateCollection(options: TeamServerKey & { name: string }): Promise<TeamCollection> {
  const signIn = await signInFor(options);
  return call<TeamCollection>(signIn.url, basic(signIn.username, signIn.token), 'POST', 'collections', { name: options.name.trim() });
}

export interface TeamBridgeAPI {
  connect: typeof teamConnect;
  disconnect: typeof teamDisconnect;
  collections: typeof teamCollections;
  create: typeof teamCreateCollection;
}
