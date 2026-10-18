/**
 * @jest-environment node
 */
import path from 'path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';
import YAML from 'yaml';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { type GitRemote, hasGitHttpBackend, startGitServer } from '../../../__jest__/git-server';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR } from '../git-vcs';
import { MemClient } from '../mem-client';
import { NeDBClient } from '../ne-db-client';
import { routableFSClient } from '../routable-fs-client';

// the real clone (the tests' mock of isomorphic-git stubs it), and the app's
// client, which goes through the main process, straight to the server instead
jest.unmock('isomorphic-git');
jest.mock('../http-client', () => ({ httpClient: jest.requireActual('isomorphic-git/http/node') }));

const workspace = { _id: 'wrk_1', type: models.workspace.type, parentId: null, name: 'Pets', scope: 'collection' };
const request = { _id: 'req_1', type: models.request.type, parentId: 'wrk_1', name: 'list pets', method: 'GET', url: 'https://pets.example.com/pets' };
const file = (doc: { _id: string; type: string }) => `.insomnium/${doc.type}/${doc._id}.yml`;

(hasGitHttpBackend ? describe : describe.skip)('pulling from a remote', () => {
  let gitServer: Awaited<ReturnType<typeof startGitServer>>;
  let remote: GitRemote;

  // a commit made elsewhere and pushed
  const pushUpstream = (docs: object[], message: string) => remote.push(
    Object.fromEntries((docs as { _id: string; type: string }[]).map(doc => [file(doc), YAML.stringify(doc)])),
    message,
  );
  const shallowFile = () => (GitVCS.getFs() as git.PromiseFsClient).promises.readFile(path.join(GIT_INTERNAL_DIR, 'shallow'), 'utf8').then(String, () => '');

  beforeAll(async () => {
    gitServer = await startGitServer();
  });
  afterAll(() => gitServer.close());

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    await models.workspace.create({ ...workspace, parentId: DEFAULT_PROJECT_ID });
    remote = gitServer.createRepo({ [file(workspace)]: YAML.stringify(workspace), [file(request)]: YAML.stringify(request) });

    await GitVCS.initFromClone({
      repoId: 'git_1',
      url: remote.url,
      directory: GIT_CLONE_DIR,
      fs: routableFSClient(MemClient.createClient(), {
        [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
        [GIT_INTERNAL_DIR]: MemClient.createClient(),
      }),
      gitDirectory: GIT_INTERNAL_DIR,
      workspaceId: 'wrk_1',
    });
    await GitVCS.setAuthor('Ana', 'ana@example.com');
  });

  afterEach(() => jest.restoreAllMocks());

  it("merges what was pushed since the last fetch, however many commits, with this side's own", async () => {
    // a commit here, so the pull is a merge, which needs where the two sides parted
    await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
    await GitVCS.add(file({ _id: 'req_2', type: models.request.type }));
    await GitVCS.commit('add pet');
    pushUpstream([{ ...request, name: 'list all pets' }], 'rename');
    pushUpstream([{ ...request, name: 'list all pets', url: 'https://pets.example.com/v2/pets' }], 'v2');

    // the Git Sync menu's fetch (every five minutes), then a pull
    await GitVCS.fetch({ singleBranch: true });
    await GitVCS.pull();

    expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets', url: 'https://pets.example.com/v2/pets' });
    expect(await models.request.getById('req_2')).toMatchObject({ name: 'add pet' });
    expect(await shallowFile()).toBe('');
    // (isomorphic-git's log lists a merge's common ancestor once for each side)
    const history = (await GitVCS.log()).map(entry => entry.commit.message.trim());
    expect(history[0]).toMatch(/^Merge/);
    expect(new Set(history)).toEqual(new Set([history[0], 'v2', 'rename', 'add pet', 'first']));
  });

  it('deepens a repository an earlier version left shallow, and then pulls', async () => {
    pushUpstream([{ ...request, name: 'list all pets' }], 'rename');
    pushUpstream([{ ...request, name: 'list every pet' }], 'rename again');
    // as fetches up to 0.4.0 did
    await git.fetch({ ...GitVCS._baseOpts, remote: 'origin', depth: 1, singleBranch: true });
    expect(await shallowFile()).not.toBe('');
    pushUpstream([{ ...request, name: 'list the pets' }], 'and again');

    await GitVCS.pull();

    expect((await models.request.getById('req_1'))?.name).toBe('list the pets');
    expect(await shallowFile()).toBe('');
    expect((await GitVCS.log()).map(entry => entry.commit.message.trim())).toEqual(['and again', 'rename again', 'rename', 'first']);
  });

  it('shows the history here without going to the remote', async () => {
    const fetching = jest.spyOn(git, 'fetch');

    expect((await GitVCS.log()).map(entry => entry.commit.message.trim())).toEqual(['first']);
    expect(fetching).not.toHaveBeenCalled();
  });
});
