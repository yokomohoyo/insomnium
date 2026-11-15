import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ActionFunction, ActionFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { ChangeBufferEvent, database } from '../../../common/database';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import type { Request } from '../../../models/request';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR } from '../../../sync/git/git-vcs';
import { MemClient } from '../../../sync/git/mem-client';
import { NeDBClient } from '../../../sync/git/ne-db-client';
import { routableFSClient } from '../../../sync/git/routable-fs-client';
import { gitChangesLoader, gitFetchAction, gitLogLoader, gitStashAction, mergeGitBranchAction, rebaseGitBranchAction, updateGitRepoAction } from '../git-actions';

const WORKSPACE = '.insomnium/Workspace/wrk_1.yml';
const REQUEST = '.insomnium/Request/req_1.yml';
const URL = 'http://example.com/merged';

const submit = (action: ActionFunction, fields: Record<string, string>) => {
  const formData = new FormData();
  Object.entries(fields).forEach(([name, value]) => formData.set(name, value));
  return action({
    request: { formData: async () => formData },
    params: { workspaceId: 'wrk_1' },
  } as unknown as ActionFunctionArgs);
};

const setUrl = async (url: string) => models.request.update((await models.request.getById('req_1'))!, { url });

// the open request's editors remount only when the window hears git changed it
describe('a doc git rewrites', () => {
  let heard: ChangeBufferEvent[] = [];
  const listen = (changes: ChangeBufferEvent[]) => {
    heard.push(...changes);
  };
  const told = () => heard.some(([, doc, fromSync]) => doc._id === 'req_1' && (doc as Request).url === URL && fromSync);

  beforeEach(async () => {
    await globalBeforeEach();
    await models.workspace.create({ _id: 'wrk_1', parentId: DEFAULT_PROJECT_ID });
    await models.request.create({ _id: 'req_1', parentId: 'wrk_1', url: '' });
    const repo = await models.gitRepository.create({ uri: '' });
    await models.workspaceMeta.update(await models.workspaceMeta.getOrCreateByParentId('wrk_1'), { gitRepositoryId: repo._id });

    await GitVCS.init({
      uri: '',
      repoId: repo._id,
      directory: GIT_CLONE_DIR,
      fs: routableFSClient(MemClient.createClient(), {
        [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
        [GIT_INTERNAL_DIR]: MemClient.createClient(),
      }),
      gitDirectory: GIT_INTERNAL_DIR,
    });
    await GitVCS.setAuthor('a', 'a@example.com');
    await GitVCS.add(WORKSPACE);
    await GitVCS.add(REQUEST);
    await GitVCS.commit('one');
    heard = [];
    database.onChange(listen);
  });

  afterEach(() => database.offChange(listen));

  const onFeature = async () => {
    await GitVCS.branch('feature', true);
    await setUrl(URL);
    await GitVCS.add(REQUEST);
    await GitVCS.commit('url');
    await GitVCS.checkout('main');
    heard = [];
  };

  it('in a merge is told to the window', async () => {
    await onFeature();
    expect(await submit(mergeGitBranchAction, { branch: 'feature' })).toEqual({});
    expect((await models.request.getById('req_1'))?.url).toBe(URL);
    expect(told()).toBe(true);
  });

  it('in a rebase is told to the window', async () => {
    await onFeature();
    expect(await submit(rebaseGitBranchAction, { branch: 'feature' })).toEqual({});
    expect((await models.request.getById('req_1'))?.url).toBe(URL);
    expect(told()).toBe(true);
  });

  it('in a stash pop is told to the window', async () => {
    await setUrl(URL);
    expect(await submit(gitStashAction, { intent: 'stash' })).toEqual({});
    expect((await models.request.getById('req_1'))?.url).toBe('');
    heard = [];
    const [stash] = await GitVCS.listStashes();
    expect(await submit(gitStashAction, { intent: 'pop', id: stash.id })).toEqual({});
    expect((await models.request.getById('req_1'))?.url).toBe(URL);
    expect(told()).toBe(true);
  });
});

// what went wrong reaches the window, in place of an empty history or no changes
describe('a git read that fails', () => {
  const args = { params: { organizationId: 'org_1', projectId: DEFAULT_PROJECT_ID, workspaceId: 'wrk_1' } } as unknown as ActionFunctionArgs;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.workspace.create({ _id: 'wrk_1', parentId: DEFAULT_PROJECT_ID });
    const repo = await models.gitRepository.create({ uri: 'https://example.com/repo.git' });
    await models.workspaceMeta.update(await models.workspaceMeta.getOrCreateByParentId('wrk_1'), { gitRepositoryId: repo._id });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('says why the fetch failed', async () => {
    jest.spyOn(GitVCS, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND example.com'));
    expect(await gitFetchAction(args)).toEqual({ errors: ['getaddrinfo ENOTFOUND example.com'] });
  });

  it('says why the history could not be read', async () => {
    jest.spyOn(GitVCS, 'log').mockRejectedValue(new Error('Could not find refs/heads/main'));
    expect(await gitLogLoader(args)).toEqual({ errors: ['Could not find refs/heads/main'] });
  });

  it('says why the changes could not be read', async () => {
    jest.spyOn(GitVCS, 'getBranch').mockResolvedValue('main');
    jest.spyOn(GitVCS, 'listFiles').mockRejectedValue(new Error('The index is corrupt'));
    expect(await gitChangesLoader(args)).toEqual({ branch: 'main', changes: [], statusNames: {}, errors: ['The index is corrupt'] });
  });
});

// a cloned repository's settings: its address stays, its sign-in can change
describe("a repository's settings", () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.workspace.create({ _id: 'wrk_1', parentId: DEFAULT_PROJECT_ID });
    const repo = await models.gitRepository.create({ uri: 'https://example.com/repo.git', credentials: { username: 'kim', password: 'old-token' } });
    await models.workspaceMeta.update(await models.workspaceMeta.getOrCreateByParentId('wrk_1'), { gitRepositoryId: repo._id });
  });
  const saved = async () => (await models.gitRepository.all())[0];
  const fields = { uri: '', authorName: 'Kim', authorEmail: 'kim@example.com', username: 'kim' };

  it('take a new token, and keep the address', async () => {
    await submit(updateGitRepoAction, { ...fields, token: 'new-token' });
    expect((await saved()).credentials).toEqual({ username: 'kim', password: 'new-token' });
    expect((await saved()).uri).toBe('https://example.com/repo.git');
  });

  it('keep the token they had when the field is left empty', async () => {
    await submit(updateGitRepoAction, { ...fields, authorName: 'Kim Lee', token: '' });
    expect((await saved()).credentials).toEqual({ username: 'kim', password: 'old-token' });
    expect((await saved()).author.name).toBe('Kim Lee');
  });
});
