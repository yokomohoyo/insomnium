import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { database as db } from '../../../common/database';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR } from '../git-vcs';
import { MemClient } from '../mem-client';
import { NeDBClient } from '../ne-db-client';
import { routableFSClient } from '../routable-fs-client';

const author = { name: 'a', email: 'a@example.com', timestamp: 1, timezoneOffset: 0 };
const file = (type: string, id: string) => `.insomnium/${type}/${id}.yml`;
const WORKSPACE = file(models.workspace.type, 'wrk_1');
const FOLDER = file(models.requestGroup.type, 'fld_1');
const IN_FOLDER = file(models.request.type, 'req_1');
const REQUEST = file(models.request.type, 'req_2');
const OTHER = file(models.request.type, 'req_3');

// the layout git-actions.tsx sets up: the work tree's .insomnium is the database
const fs = () => routableFSClient(MemClient.createClient(), {
  [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
  [GIT_INTERNAL_DIR]: MemClient.createClient(),
});
const opts = () => ({ fs: GitVCS.getFs(), dir: GIT_CLONE_DIR, gitdir: GIT_INTERNAL_DIR });

// the tree of a commit without some of its files, leaving out emptied folders
const treeWithout = async (oid: string, drop: string[], dir = ''): Promise<string | null> => {
  const entries = [];
  for (const entry of (await git.readTree({ ...opts(), oid })).tree) {
    const filepath = dir ? `${dir}/${entry.path}` : entry.path;
    if (drop.includes(filepath)) {
      continue;
    }
    if (entry.type !== 'tree') {
      entries.push(entry);
      continue;
    }
    const subtree = await treeWithout(entry.oid, drop, filepath);
    if (subtree) {
      entries.push({ ...entry, oid: subtree });
    }
  }
  return entries.length ? git.writeTree({ ...opts(), tree: entries }) : null;
};

// what a pull does once it has fetched a commit that deleted these files
const pullDeleting = async (...drop: string[]) => {
  const head = await git.resolveRef({ ...opts(), ref: 'HEAD' });
  const tree = await treeWithout(head, drop);
  const incoming = await git.writeCommit({ ...opts(), commit: { message: 'incoming\n', tree: tree!, parent: [head], author, committer: author } });
  await git.writeRef({ ...opts(), ref: 'refs/heads/incoming', value: incoming });
  jest.spyOn(git, 'fetch').mockResolvedValue({ defaultBranch: 'main', fetchHead: incoming, fetchHeadDescription: 'incoming' });
  await GitVCS.pull();
};

describe('docs removed upstream', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    await models.workspace.create({ _id: 'wrk_1', parentId: DEFAULT_PROJECT_ID });
    await models.requestGroup.create({ _id: 'fld_1', parentId: 'wrk_1' });
    await models.request.create({ _id: 'req_1', parentId: 'fld_1' });
    await models.request.create({ _id: 'req_2', parentId: 'wrk_1' });
    await models.request.create({ _id: 'req_3', parentId: 'wrk_1' });
    await models.requestMeta.create({ _id: 'reqm_2', parentId: 'req_2' });

    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: fs(), gitDirectory: GIT_INTERNAL_DIR });
    await GitVCS.setAuthor('a', 'a@example.com');
    for (const filepath of [WORKSPACE, FOLDER, IN_FOLDER, REQUEST, OTHER]) {
      await GitVCS.add(filepath);
    }
    await GitVCS.commit('one');
  });

  afterEach(() => jest.restoreAllMocks());

  it('are removed from the app by a pull, with what hangs off them', async () => {
    await pullDeleting(FOLDER, IN_FOLDER, REQUEST);

    expect(await db.get(models.requestGroup.type, 'fld_1')).toBeNull();
    expect(await db.get(models.request.type, 'req_1')).toBeNull();
    expect(await db.get(models.request.type, 'req_2')).toBeNull();
    expect(await db.get(models.requestMeta.type, 'reqm_2')).toBeNull();
    expect(await db.get(models.request.type, 'req_3')).not.toBeNull();
    // they used to come back as added
    expect(await GitVCS.status(REQUEST)).toBe('absent');
    expect(await GitVCS.status(IN_FOLDER)).toBe('absent');
  });

  it('are removed by a merge a document at a time too', async () => {
    const head = await git.resolveRef({ ...opts(), ref: 'HEAD' });
    const tree = await treeWithout(head, [REQUEST]);
    const incoming = await git.writeCommit({ ...opts(), commit: { message: 'incoming\n', tree: tree!, parent: [head], author, committer: author } });
    await git.writeRef({ ...opts(), ref: 'refs/heads/incoming', value: incoming });

    await GitVCS.mergeByField('incoming');

    expect(await db.get(models.request.type, 'req_2')).toBeNull();
    expect(await db.get(models.request.type, 'req_3')).not.toBeNull();
    expect(await GitVCS.status(REQUEST)).toBe('absent');
  });

  it('stay when they have changes that were never committed, and so does their folder', async () => {
    const request = await models.request.getById('req_1');
    await models.request.update(request!, { name: 'changed here' });

    await pullDeleting(FOLDER, IN_FOLDER);

    expect((await models.request.getById('req_1'))?.name).toBe('changed here');
    expect(await db.get(models.requestGroup.type, 'fld_1')).not.toBeNull();
    expect(await GitVCS.status(IN_FOLDER)).toBe('*added');
  });

  it('stay when a doc that was never committed is under them', async () => {
    await models.request.create({ _id: 'req_new', parentId: 'fld_1' });

    await pullDeleting(FOLDER, IN_FOLDER);

    expect(await db.get(models.requestGroup.type, 'fld_1')).not.toBeNull();
    expect(await db.get(models.request.type, 'req_new')).not.toBeNull();
    expect(await db.get(models.request.type, 'req_1')).toBeNull();
  });

  it('stay when they are not under the repository\'s workspace', async () => {
    // committed from this workspace, then moved to another
    await models.workspace.create({ _id: 'wrk_2', parentId: DEFAULT_PROJECT_ID });
    const request = await models.request.create({ _id: 'req_9', parentId: 'wrk_1' });
    await GitVCS.add(file(models.request.type, 'req_9'));
    await GitVCS.commit('two');
    await models.request.update(request, { parentId: 'wrk_2' });

    await pullDeleting(file(models.request.type, 'req_9'));

    expect(await db.get(models.request.type, 'req_9')).not.toBeNull();
  });

  it('never include the workspace', async () => {
    await pullDeleting(WORKSPACE);

    expect(await db.get(models.workspace.type, 'wrk_1')).not.toBeNull();
  });

  it('go when switching to a branch without them, and come back with the branch', async () => {
    await GitVCS.checkout('feature');
    await models.request.create({ _id: 'req_4', parentId: 'wrk_1' });
    await GitVCS.add(file(models.request.type, 'req_4'));
    await GitVCS.commit('two');

    await GitVCS.checkout('main');
    expect(await db.get(models.request.type, 'req_4')).toBeNull();

    await GitVCS.checkout('feature');
    expect(await db.get(models.request.type, 'req_4')).not.toBeNull();
  });
});
