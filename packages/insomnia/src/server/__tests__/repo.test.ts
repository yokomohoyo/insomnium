/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import YAML from 'yaml';

import { type GitRemote, hasGitHttpBackend, startGitServer } from '../../__jest__/git-server';
import * as models from '../../models';
import { setRequestPolicy } from '../../network/request-policy';
import { isRemoteRepo } from '../repo';
import { loadSources } from '../server';

// the real clone (the tests' mock of isomorphic-git stubs it)
jest.unmock('isomorphic-git');
jest.mock('electron');

const doc = (type: string, _id: string, fields: object) => ({ _id, type, ...fields });
const workspace = doc(models.workspace.type, 'wrk_1', { parentId: null, name: 'Pets', scope: 'collection' });
const base = doc(models.environment.type, 'env_1', { parentId: 'wrk_1', name: 'Base Environment', data: { host: 'pets.example.com' } });
const list = doc(models.request.type, 'req_1', { parentId: 'wrk_1', name: 'list pets', method: 'GET', url: 'https://{{ host }}/pets' });
const add = doc(models.request.type, 'req_2', { parentId: 'wrk_1', name: 'add pet', method: 'POST', url: 'https://{{ host }}/pets' });
const file = ({ _id, type }: { _id: string; type: string }) => `.insomnium/${type}/${_id}.yml`;
const files = (...docs: { _id: string; type: string }[]) => Object.fromEntries(docs.map(d => [file(d), YAML.stringify(d)]));

const load = (repos: string[]) => loadSources({ collections: [], repos, variables: { token: 'from-the-deployment' }, validateSSL: true, allowedHosts: ['*'], allowedEnvironmentVariables: '' });
const names = async () => (await models.request.all()).map(request => request.name).sort();

describe('a repository to serve', () => {
  afterAll(() => setRequestPolicy(null));

  it('is a URL to clone, or else a directory', () => {
    expect(isRemoteRepo('https://github.com/org/api.git')).toBe(true);
    expect(isRemoteRepo('git@github.com:org/api.git')).toBe(true);
    expect(isRemoteRepo('/data/api')).toBe(false);
    expect(isRemoteRepo('C:\\repos\\api')).toBe(false);
  });

  it('as a mounted checkout, is read again when its files change', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-checkout-'));
    const write = (changes: Record<string, string>) => Object.entries(changes).forEach(([name, content]) => {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    });
    write(files(workspace, base, list));
    const { workspaces, update } = await load([dir]);
    expect(workspaces.map(({ name }) => name)).toEqual(['Pets']);
    expect(await names()).toEqual(['list pets']);

    expect(await update()).toEqual([]);
    write(files(add));
    expect((await update()).map(({ location }) => location)).toEqual([dir]);
    expect(await names()).toEqual(['add pet', 'list pets']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('needs a workspace, and refuses a path that is neither', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-empty-'));
    await expect(load([empty])).rejects.toThrow('has no Insomnium workspace');
    await expect(load([path.join(empty, 'missing')])).rejects.toThrow('is not a directory, nor a Git URL');
    await expect(load(['ssh://git@example.com/api.git'])).rejects.toThrow('only http(s) Git remotes can be cloned');
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

(hasGitHttpBackend ? describe : describe.skip)('a repository cloned to serve', () => {
  let gitServer: Awaited<ReturnType<typeof startGitServer>>;
  let remote: GitRemote;

  beforeAll(async () => {
    gitServer = await startGitServer();
  });
  afterAll(() => gitServer.close());

  it('follows what is pushed: changes, additions and deletions, keeping the responses of what stays', async () => {
    remote = gitServer.createRepo(files(workspace, base, list, add));
    const { workspaces, update } = await load([remote.url]);
    expect(workspaces.map(({ _id, name }) => ({ _id, name }))).toEqual([{ _id: 'wrk_1', name: 'Pets' }]);
    expect(await names()).toEqual(['add pet', 'list pets']);
    // a response an MCP client got from a send
    await models.response.create({ parentId: 'req_1', statusCode: 200 });

    expect(await update()).toEqual([]);
    remote.push({
      ...files({ ...list, name: 'list all pets' }, doc(models.request.type, 'req_3', { parentId: 'wrk_1', name: 'find pet', method: 'GET', url: 'https://{{ host }}/pets/1' })),
      [file(add)]: null,
    }, 'rename, add, remove');
    const [changed] = await update();

    expect(changed.location).toBe(remote.url);
    expect(changed.version).toMatch(/^[0-9a-f]{40}$/);
    expect(await names()).toEqual(['find pet', 'list all pets']);
    expect((await models.response.findByParentId('req_1')).map(({ statusCode }) => statusCode)).toEqual([200]);
    // the deployment's variables, over the repository's environment
    expect((await models.environment.getById('env_1'))?.data).toEqual({ host: 'pets.example.com', token: 'from-the-deployment' });
  });

  it('refuses one whose workspace is already loaded from elsewhere', async () => {
    remote = gitServer.createRepo(files(workspace, list));
    await expect(load([remote.url, remote.url])).rejects.toThrow("already loaded from another collection or repository");
  });
});
