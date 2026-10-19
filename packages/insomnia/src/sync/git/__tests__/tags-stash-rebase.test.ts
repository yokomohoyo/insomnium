/**
 * @jest-environment node
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';
import YAML from 'yaml';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { type GitRemote, hasGitHttpBackend, startGitServer } from '../../../__jest__/git-server';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR, GitConflictsError, GitLocalChangesError } from '../git-vcs';
import { MemClient } from '../mem-client';
import { NeDBClient } from '../ne-db-client';
import { routableFSClient } from '../routable-fs-client';

// the real clone (the tests' mock of isomorphic-git stubs it), and the app's
// client, which goes through the main process, straight to the server instead
jest.unmock('isomorphic-git');
jest.mock('../http-client', () => ({ httpClient: jest.requireActual('isomorphic-git/http/node') }));

const workspace = { _id: 'wrk_1', type: models.workspace.type, parentId: null, name: 'Pets', scope: 'collection' };
const request = { _id: 'req_1', type: models.request.type, parentId: 'wrk_1', name: 'list pets', method: 'GET', url: 'https://pets.example.com/pets' };
const file = (doc: { _id: string; type?: string }) => `.insomnium/${doc.type || models.request.type}/${doc._id}.yml`;
const messages = async () => (await GitVCS.log()).map(entry => entry.commit.message.trim());
const head = () => git.resolveRef({ ...GitVCS._baseOpts, ref: 'HEAD' });

(hasGitHttpBackend ? describe : describe.skip)('tags, stashes and rebases', () => {
  let gitServer: Awaited<ReturnType<typeof startGitServer>>;
  let remote: GitRemote;

  // a commit made elsewhere and pushed
  const pushUpstream = (docs: object[], message: string) => remote.push(
    Object.fromEntries((docs as { _id: string; type: string }[]).map(doc => [file(doc), YAML.stringify(doc)])),
    message,
  );
  // a commit here, of what the app has
  const commitHere = async (message: string, ...ids: string[]) => {
    for (const id of ids) {
      await GitVCS.add(file({ _id: id }));
    }
    await GitVCS.commit(message);
  };
  const rename = async (id: string, name: string) => {
    const doc = await models.request.getById(id);
    await models.request.update(doc!, { name });
  };

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

  describe('tags', () => {
    it('tags the current commit, lightweight or with a message', async () => {
      await GitVCS.createTag('v1');
      await GitVCS.createTag('v2', 'the second\n');

      const oid = await head();
      expect(await GitVCS.listTags()).toEqual([
        { name: 'v2', oid, message: 'the second' },
        { name: 'v1', oid, message: '' },
      ]);
    });

    it('pushes a tag, and deletes it there too', async () => {
      await GitVCS.createTag('v1', 'first release');
      await GitVCS.pushTag('v1');
      expect(remote.tags()).toEqual(['v1']);

      await GitVCS.deleteTag('v1', { remote: true });
      expect(remote.tags()).toEqual([]);
      expect(await GitVCS.listTags()).toEqual([]);
    });

    it("fetches the remote's tags and keeps the ones made here", async () => {
      await GitVCS.createTag('here');
      pushUpstream([{ ...request, name: 'renamed' }], 'rename');
      remote.tag('there');

      await GitVCS.fetch({ singleBranch: true });

      expect((await GitVCS.listTags()).map(tag => tag.name)).toEqual(['there', 'here']);
    });

    it("pulls an annotated tag, with its own object and message", async () => {
      pushUpstream([{ ...request, name: 'renamed' }], 'rename');
      remote.tag('v1.0.0', 'the first release');

      await GitVCS.pull(null);

      expect(await GitVCS.listTags()).toEqual([{ name: 'v1.0.0', oid: await head(), message: 'the first release' }]);
    });
  });

  describe('a tag named as a branch', () => {
    it('pulls into the branch, not the tag', async () => {
      // the remote's tag, on the first commit, comes here with the pull
      remote.tag('main');
      const first = await head();
      await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
      await commitHere('add pet', 'req_2');
      pushUpstream([{ ...request, name: 'list all pets' }], 'rename');

      await GitVCS.pull(null);

      expect(await GitVCS.getBranch()).toBe('main');
      expect(await git.resolveRef({ ...GitVCS._baseOpts, ref: 'refs/tags/main' })).toBe(first);
      const [merge, ...rest] = await messages();
      expect(merge).toMatch(/^Merge/);
      expect(rest.sort()).toEqual(['add pet', 'first', 'rename']);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets' });
    });

    it('rebases onto the branch, and switches to it, not the tag', async () => {
      await GitVCS.createTag('feature');
      const first = await head();
      await GitVCS.branch('feature', true);
      await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
      await commitHere('add pet', 'req_2');
      await GitVCS.checkout('main');
      await rename('req_1', 'list all pets');
      await commitHere('rename', 'req_1');

      expect(await GitVCS.rebase('feature')).toEqual({ rebased: 1 });
      expect(await messages()).toEqual(['rename', 'add pet', 'first']);
      expect(await GitVCS.getBranch()).toBe('main');

      await GitVCS.checkout('feature');
      expect(await GitVCS.getBranch()).toBe('feature');
      expect(await git.resolveRef({ ...GitVCS._baseOpts, ref: 'refs/tags/feature' })).toBe(first);
    });

    it("won't make a tag named as a branch", async () => {
      await expect(GitVCS.createTag('main')).rejects.toThrow("There's a branch named main");
      expect(await GitVCS.listTags()).toEqual([]);
    });
  });

  describe('stashes', () => {
    it('keeps changes and new documents aside, then brings them back', async () => {
      await rename('req_1', 'list all pets');
      await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
      const files = [file({ _id: 'req_1' }), file({ _id: 'req_2' })];

      const id = await GitVCS.stash(files, 'half done');
      // what the action does next: undo them
      await GitVCS.undoPendingChanges([files[0]]);
      await (GitVCS.getFs() as git.PromiseFsClient).promises.unlink(files[1]);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list pets' });
      expect(await models.request.getById('req_2')).toBeNull();

      expect(await GitVCS.listStashes()).toEqual([expect.objectContaining({ id, message: 'half done', branch: 'main', files })]);

      await GitVCS.applyStash(id, { drop: true });
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets' });
      expect(await models.request.getById('req_2')).toMatchObject({ name: 'add pet' });
      expect(await GitVCS.listStashes()).toEqual([]);
    });

    it("takes the changes list's paths with Windows separators, a deletion too", async () => {
      await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
      await commitHere('add pet', 'req_2');
      await rename('req_1', 'list all pets');
      await models.request.remove((await models.request.getById('req_2'))!);
      const files = [file({ _id: 'req_1' }), file({ _id: 'req_2' })];

      const id = await GitVCS.stash(files.map(name => name.replace(/\//g, '\\')), 'on windows');
      await GitVCS.undoPendingChanges(files);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list pets' });
      expect(await models.request.getById('req_2')).toMatchObject({ name: 'add pet' });

      expect(await GitVCS.listStashes()).toEqual([expect.objectContaining({ id, message: 'on windows', files })]);
      await GitVCS.applyStash(id);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets' });
      expect(await models.request.getById('req_2')).toBeNull();
    });

    it("throws, keeping nothing, when the stash can't be read back", async () => {
      await rename('req_1', 'list all pets');
      // tree entries isomorphic-git won't read back
      const writeTree = git.writeTree;
      jest.spyOn(git, 'writeTree').mockImplementation(args => writeTree({
        ...args,
        tree: args.tree.map(entry => (entry.type === 'blob' ? { ...entry, path: `x\\${entry.path}` } : entry)),
      }));

      await expect(GitVCS.stash([file({ _id: 'req_1' })], '')).rejects.toThrow("The changes couldn't be stashed");
      expect(await GitVCS.listStashes()).toEqual([]);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets' });
    });

    it("lists the stashes it can read, past one it can't", async () => {
      await rename('req_1', 'list all pets');
      const id = await GitVCS.stash([file({ _id: 'req_1' })], 'readable');
      // as one made from a Windows path was
      const blob = await git.writeBlob({ ...GitVCS._baseOpts, blob: Buffer.from('name: list all pets\n') });
      const tree = await git.writeTree({ ...GitVCS._baseOpts, tree: [{ mode: '100644', path: '.insomnium\\Request\\req_1.yml', oid: blob, type: 'blob' }] });
      const when = { name: 'Ana', email: 'ana@example.com', timestamp: 1, timezoneOffset: 0 };
      const broken = await git.writeCommit({ ...GitVCS._baseOpts, commit: { message: 'broken\n', tree, parent: [await head()], author: when, committer: when } });
      await git.writeRef({ ...GitVCS._baseOpts, ref: 'refs/insomnium/stash/1', value: broken });

      expect(await GitVCS.listStashes()).toEqual([expect.objectContaining({ id, message: 'readable' })]);
    });

    it('applies onto changes made since, field by field', async () => {
      await rename('req_1', 'list all pets');
      const id = await GitVCS.stash([file({ _id: 'req_1' })], '');
      await GitVCS.undoPendingChanges([file({ _id: 'req_1' })]);

      const doc = await models.request.getById('req_1');
      await models.request.update(doc!, { url: 'https://pets.example.com/v2/pets' });
      await commitHere('v2', 'req_1');

      await GitVCS.applyStash(id);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets', url: 'https://pets.example.com/v2/pets' });
      // applied, not popped
      expect(await GitVCS.listStashes()).toHaveLength(1);
    });

    it('lists what clashes, and writes nothing until a choice settles it', async () => {
      await rename('req_1', 'stashed name');
      const id = await GitVCS.stash([file({ _id: 'req_1' })], '');
      await rename('req_1', 'name since');

      const error = await GitVCS.applyStash(id).catch(err => err);
      expect(error).toBeInstanceOf(GitConflictsError);
      expect(error.conflicts).toEqual([expect.objectContaining({ file: file({ _id: 'req_1' }), fields: [expect.objectContaining({ field: 'name', ours: 'name since', theirs: 'stashed name' })] })]);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'name since' });

      await GitVCS.applyStash(id, { choices: { [file({ _id: 'req_1' })]: 'theirs' } });
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'stashed name' });
    });
  });

  describe('rebases', () => {
    it("pulls with a rebase: this side's commits go on top, with no merge", async () => {
      await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
      await commitHere('add pet', 'req_2');
      pushUpstream([{ ...request, name: 'list all pets' }], 'rename');
      pushUpstream([{ ...request, name: 'list all pets', url: 'https://pets.example.com/v2/pets' }], 'v2');

      await GitVCS.pull(null, {}, true);

      expect(await messages()).toEqual(['add pet', 'v2', 'rename', 'first']);
      const log = await GitVCS.log();
      expect(log.every(entry => entry.commit.parent.length <= 1)).toBe(true);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets', url: 'https://pets.example.com/v2/pets' });
      expect(await models.request.getById('req_2')).toMatchObject({ name: 'add pet' });
    });

    it('merges a document both sides changed by its fields', async () => {
      const doc = await models.request.getById('req_1');
      await models.request.update(doc!, { url: 'https://pets.example.com/v2/pets' });
      await commitHere('v2', 'req_1');
      pushUpstream([{ ...request, name: 'list all pets' }], 'rename');

      await GitVCS.pull(null, {}, true);

      expect(await messages()).toEqual(['v2', 'rename', 'first']);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets', url: 'https://pets.example.com/v2/pets' });
    });

    it('leaves everything as it was on a clash, and replays with the choices', async () => {
      await rename('req_1', 'mine');
      await commitHere('mine', 'req_1');
      pushUpstream([{ ...request, name: 'theirs' }], 'theirs');
      const before = await head();

      const error = await GitVCS.pull(null, {}, true).catch(err => err);
      expect(error).toBeInstanceOf(GitConflictsError);
      // yours is this side's commit, as in a merge
      expect(error.conflicts).toEqual([expect.objectContaining({ fields: [expect.objectContaining({ field: 'name', ours: 'mine', theirs: 'theirs' })] })]);
      expect(await head()).toBe(before);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'mine' });

      await GitVCS.pull(null, { [file({ _id: 'req_1' })]: 'ours' }, true);
      expect(await messages()).toEqual(['mine', 'theirs', 'first']);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'mine' });
    });

    it('rebases a branch onto another', async () => {
      await GitVCS.branch('feature', true);
      await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
      await commitHere('add pet', 'req_2');
      await GitVCS.checkout('main');
      await rename('req_1', 'list all pets');
      await commitHere('rename', 'req_1');
      await GitVCS.checkout('feature');

      expect(await GitVCS.rebase('main')).toEqual({ rebased: 1 });

      expect(await messages()).toEqual(['add pet', 'rename', 'first']);
      expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets' });
      expect(await models.request.getById('req_2')).toMatchObject({ name: 'add pet' });
      // nothing to do the second time
      expect(await GitVCS.rebase('main')).toEqual({ rebased: 0 });
    });

    it("won't write over changes that aren't committed", async () => {
      await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
      await commitHere('add pet', 'req_2');
      pushUpstream([{ ...request, name: 'list all pets' }], 'rename');
      await rename('req_1', 'not committed');

      await expect(GitVCS.pull(null, {}, true)).rejects.toBeInstanceOf(GitLocalChangesError);
      expect(await messages()).toEqual(['add pet', 'first']);
    });
  });
});
