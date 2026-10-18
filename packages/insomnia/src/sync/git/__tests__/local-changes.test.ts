import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR, GitLocalChangesError } from '../git-vcs';
import { MemClient } from '../mem-client';
import { NeDBClient } from '../ne-db-client';
import { routableFSClient } from '../routable-fs-client';

const file = (type: string, id: string) => `.insomnium/${type}/${id}.yml`;
const WORKSPACE = file(models.workspace.type, 'wrk_1');
const LIST = file(models.request.type, 'req_1');
const ADD = file(models.request.type, 'req_2');

// the layout git-actions.tsx sets up: the work tree's .insomnium is the database
const fs = () => routableFSClient(MemClient.createClient(), {
  [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
  [GIT_INTERNAL_DIR]: MemClient.createClient(),
});
const opts = () => ({ fs: GitVCS.getFs(), dir: GIT_CLONE_DIR, gitdir: GIT_INTERNAL_DIR });
const head = () => git.resolveRef({ ...opts(), ref: 'HEAD' });
const rename = async (id: string, name: string) => models.request.update((await models.request.getById(id))!, { name });
const nameOf = async (id: string) => (await models.request.getById(id))?.name;
const writeOther = (text: string) => (GitVCS.getFs() as git.PromiseFsClient).promises.writeFile('package.json', text);

// a commit on 'upstream' that renames 'list pets', as a pull would fetch it
const upstream = async (change = () => rename('req_1', 'list all pets'), files = [LIST]) => {
  await GitVCS.checkout('upstream');
  await change();
  for (const filepath of files) {
    await GitVCS.add(filepath);
  }
  await GitVCS.commit('upstream');
  const oid = await head();
  await GitVCS.checkout('main');
  // what the fetch leaves: the remote's branch, which a merge by field takes
  await git.writeRef({ ...opts(), ref: 'refs/remotes/origin/main', value: oid, force: true });
  jest.spyOn(git, 'fetch').mockResolvedValue({ defaultBranch: 'main', fetchHead: oid, fetchHeadDescription: 'upstream' });
  return oid;
};

describe('changes that were never committed', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    await models.workspace.create({ _id: 'wrk_1', parentId: DEFAULT_PROJECT_ID });
    await models.request.create({ _id: 'req_1', parentId: 'wrk_1', name: 'list pets' });
    await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });

    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: fs(), gitDirectory: GIT_INTERNAL_DIR });
    await GitVCS.setAuthor('a', 'a@example.com');
    await writeOther('{ "name": "pets" }\n');
    for (const filepath of [WORKSPACE, LIST, ADD, 'package.json']) {
      await GitVCS.add(filepath);
    }
    await GitVCS.commit('one');
  });

  afterEach(() => jest.restoreAllMocks());

  it("aren't written over by a pull of a change to the same request: it stops, and nothing moves", async () => {
    await upstream();
    const before = await head();
    await rename('req_1', 'list my pets');

    const pulling = GitVCS.pull();

    await expect(pulling).rejects.toThrow(GitLocalChangesError);
    await expect(pulling).rejects.toThrow("Pulling would overwrite changes that aren't committed yet: list my pets (Request). Commit them, or undo them, and try again.");
    expect(await nameOf('req_1')).toBe('list my pets');
    expect(await head()).toBe(before);
  });

  it('stay when a pull changes other requests, which it brings in', async () => {
    await upstream();
    await rename('req_2', 'add a pet');

    await GitVCS.pull();

    expect(await nameOf('req_1')).toBe('list all pets');
    expect(await nameOf('req_2')).toBe('add a pet');
  });

  it("aren't in the way when they're what comes in already", async () => {
    await upstream();
    await rename('req_1', 'list all pets');

    await GitVCS.pull();

    expect(await nameOf('req_1')).toBe('list all pets');
  });

  it("aren't written over in the repository's other files either", async () => {
    await upstream(() => writeOther('{ "name": "pets", "private": true }\n'), ['package.json']);
    await writeOther('{ "name": "my-pets" }\n');

    await expect(GitVCS.pull()).rejects.toThrow('overwrite changes that aren\'t committed yet: package.json.');
  });

  it("include a request deleted here, which a pull would bring back", async () => {
    await upstream();
    await models.request.remove((await models.request.getById('req_1'))!);

    await expect(GitVCS.pull()).rejects.toThrow('list pets (Request, deleted here)');
    expect(await models.request.getById('req_1')).toBeNull();
  });

  it("aren't written over by switching to a branch where the request differs", async () => {
    await upstream();
    await rename('req_1', 'list my pets');

    await expect(GitVCS.checkout('upstream')).rejects.toThrow("Switching to upstream would overwrite changes that aren't committed yet: list my pets (Request)");
    expect(await GitVCS.getBranch()).toBe('main');
    expect(await nameOf('req_1')).toBe('list my pets');
  });

  it("aren't written over by merging a branch, a field at a time or not", async () => {
    await upstream();
    await rename('req_1', 'list my pets');

    await expect(GitVCS.mergeByField('upstream')).rejects.toThrow("Merging upstream would overwrite changes that aren't committed yet");
    expect(await nameOf('req_1')).toBe('list my pets');
  });

  it('once committed, merge with what comes in', async () => {
    await upstream(async () => {
      await models.request.update((await models.request.getById('req_1'))!, { url: 'https://pets.example.com/pets' });
    });
    await rename('req_1', 'list my pets');
    await GitVCS.add(LIST);
    await GitVCS.commit('mine');

    await GitVCS.pull();

    expect(await models.request.getById('req_1')).toMatchObject({ name: 'list my pets', url: 'https://pets.example.com/pets' });
  });
});
