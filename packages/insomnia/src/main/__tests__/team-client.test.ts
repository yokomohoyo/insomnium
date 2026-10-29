/**
 * @jest-environment node
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import { isPlainHttpOffMachine, normalizeTeamUrl } from '../../common/team-server';
import * as models from '../../models';
import { startTeamServer } from '../../server/team/server';
import type { TeamStore } from '../../server/team/store';
import { teamCollections, teamConnect, teamCreateCollection, teamDisconnect } from '../team-client';

describe('team server addresses', () => {
  it('reads a typed address, https:// unless it says otherwise', () => {
    expect(normalizeTeamUrl(' nas.example.com ')).toBe('https://nas.example.com');
    expect(normalizeTeamUrl('http://nas.local:8090/')).toBe('http://nas.local:8090');
    expect(normalizeTeamUrl('https://example.com/team/api/')).toBe('https://example.com/team');
    expect(() => normalizeTeamUrl('ftp://nas')).toThrow('https:// or http://');
    expect(() => normalizeTeamUrl('https://kim:pw@nas')).toThrow('Leave the user name');
  });

  it('warns about plain HTTP away from this computer', () => {
    expect(isPlainHttpOffMachine('http://nas.local')).toBe(true);
    expect(isPlainHttpOffMachine('http://localhost:8090')).toBe(false);
    expect(isPlainHttpOffMachine('http://127.0.0.1:8090')).toBe(false);
    expect(isPlainHttpOffMachine('https://nas.local')).toBe(false);
  });
});

describe('the team server client', () => {
  let dir: string;
  let store: TeamStore;
  let base: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-team-client-'));
    const started = await startTeamServer({ dataDir: dir, host: '127.0.0.1', port: 0 });
    store = started.store;
    base = `http://127.0.0.1:${(started.server.address() as AddressInfo).port}`;
    stop = () => new Promise(resolve => {
      started.server.close(() => resolve());
      started.server.closeAllConnections();
    });
    store.addUser('kim', 'kims long password');
    store.addUser('lee', 'lees long password');
    store.addCollection('payments', 'Payments', 'lee');
    store.setRole('payments', 'kim', 'viewer');
  });
  afterAll(async () => {
    await stop();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(globalBeforeEach);

  it('trades the password for a token of its own, and keeps only that', async () => {
    await expect(teamConnect({ url: `${base}/`, username: 'kim', password: 'kims long password' })).resolves.toEqual({ url: base, username: 'kim' });

    const { teamServers } = await models.settings.getOrCreate();
    expect(teamServers).toHaveLength(1);
    expect(teamServers[0]).toMatchObject({ url: base, username: 'kim' });
    expect(teamServers[0].token).toMatch(/^ist_/);
    expect(JSON.stringify(teamServers)).not.toContain('kims long password');
    expect(store.tokens('kim').map(token => token.label)).toEqual([`Insomnium on ${os.hostname()}`]);
  });

  it('lists the collections with their role and clone address, and makes new ones', async () => {
    await teamConnect({ url: base, username: 'kim', password: 'kims long password' });

    await expect(teamCollections({ url: base, username: 'kim' })).resolves.toEqual([
      expect.objectContaining({ slug: 'payments', name: 'Payments', role: 'viewer', cloneUrl: `${base}/git/payments.git` }),
    ]);
    await expect(teamCreateCollection({ url: base, username: 'kim', name: 'Kim Scratch' })).resolves.toMatchObject({ slug: 'kim-scratch', role: 'owner' });
    expect((await teamCollections({ url: base, username: 'kim' })).map(collection => collection.slug)).toEqual(['kim-scratch', 'payments']);
  });

  it('keeps a pasted token as it is, and signs in again over the same server', async () => {
    const { secret } = store.addToken('lee', 'pasted');
    await teamConnect({ url: base, username: 'lee', password: secret });
    await teamConnect({ url: base, username: 'lee', password: secret });

    const { teamServers } = await models.settings.getOrCreate();
    expect(teamServers).toEqual([{ url: base, username: 'lee', token: secret, tokenId: '' }]);
  });

  it('says so when the sign-in is wrong, and keeps nothing', async () => {
    await expect(teamConnect({ url: base, username: 'kim', password: 'not it' })).rejects.toThrow("didn't accept the user name and password or token");
    expect((await models.settings.getOrCreate()).teamServers).toEqual([]);
  });

  it('revokes the token it made on sign-out', async () => {
    await teamConnect({ url: base, username: 'kim', password: 'kims long password' });
    const before = store.tokens('kim').length;

    await teamDisconnect({ url: base, username: 'kim' });

    expect(store.tokens('kim')).toHaveLength(before - 1);
    expect((await models.settings.getOrCreate()).teamServers).toEqual([]);
    await expect(teamCollections({ url: base, username: 'kim' })).rejects.toThrow('Sign in to');
  });
});
