import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';
import path from 'path';
import YAML from 'yaml';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { database as db } from '../../../common/database';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR_NAME, GIT_INSOMNIA_LEGACY_DIR_NAME, GIT_INTERNAL_DIR, GitDataDirName } from '../git-vcs';
import { MemClient } from '../mem-client';
import { clonedDataDir, importClonedDocs, NeDBClient } from '../ne-db-client';
import { routableFSClient } from '../routable-fs-client';

// A repository from Insomnia (or from Insomnium before its rename) keeps its
// data in .insomnia, and keeps it there
const LEGACY = GIT_INSOMNIA_LEGACY_DIR_NAME;
const author = { name: 'a', email: 'a@example.com', timestamp: 1, timezoneOffset: 0 };
const workspace = { _id: 'wrk_9', type: models.workspace.type, name: 'From Insomnia', scope: 'collection', parentId: null };
const request = { _id: 'req_9', type: models.request.type, parentId: 'wrk_9', name: 'pets', url: 'https://example.com/pets' };
const file = (dataDirName: string, doc: { _id: string; type: string }) => `${dataDirName}/${doc.type}/${doc._id}.yml`;

// a work tree, as a shallow clone leaves it
const workTree = async (files: Record<string, object>) => {
  const fsClient = MemClient.createClient();
  for (const [filepath, doc] of Object.entries(files)) {
    await fsClient.promises.mkdir(path.join(GIT_CLONE_DIR, path.dirname(filepath)), { recursive: true });
    await fsClient.promises.writeFile(path.join(GIT_CLONE_DIR, filepath), YAML.stringify(doc));
  }
  return fsClient;
};

// the layout git-actions.tsx sets up for the repository's data folder
const layout = (dataDirName: GitDataDirName) => routableFSClient(MemClient.createClient(), {
  [path.join(GIT_CLONE_DIR, dataDirName)]: NeDBClient.createClient('wrk_9', DEFAULT_PROJECT_ID, dataDirName),
  [GIT_INTERNAL_DIR]: MemClient.createClient(),
});

// a commit of these files, written straight into the git dir
const treeOf = async (opts: object, files: [string, string][]): Promise<string> => {
  const folders = new Map<string, [string, string][]>();
  const tree = [];
  for (const [filepath, content] of files) {
    const [name, ...rest] = filepath.split('/');
    if (rest.length) {
      folders.set(name, [...(folders.get(name) || []), [rest.join('/'), content]]);
    } else {
      tree.push({ mode: '100644', path: name, type: 'blob' as const, oid: await git.writeBlob({ ...opts, blob: Buffer.from(content) } as Parameters<typeof git.writeBlob>[0]) });
    }
  }
  for (const [name, inside] of folders) {
    tree.push({ mode: '040000', path: name, type: 'tree' as const, oid: await treeOf(opts, inside) });
  }
  return git.writeTree({ ...opts, tree } as Parameters<typeof git.writeTree>[0]);
};

describe('a repository with its data in .insomnia', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('clonedDataDir()', () => {
    it('finds the folder that holds a workspace, Insomnium\'s first', async () => {
      expect(await clonedDataDir(await workTree({ [file(LEGACY, workspace)]: workspace }))).toBe(LEGACY);
      expect(await clonedDataDir(await workTree({
        [file(LEGACY, workspace)]: workspace,
        [file(GIT_INSOMNIA_DIR_NAME, workspace)]: workspace,
      }))).toBe(GIT_INSOMNIA_DIR_NAME);
      expect(await clonedDataDir(await workTree({ [file(LEGACY, request)]: request, 'README.md': {} }))).toBeNull();
    });
  });

  it('is imported from there on clone', async () => {
    const result = await importClonedDocs(await workTree({ [file(LEGACY, workspace)]: workspace, [file(LEGACY, request)]: request }), DEFAULT_PROJECT_ID, LEGACY);
    expect(result).toEqual({ workspace: expect.objectContaining({ _id: 'wrk_9', parentId: DEFAULT_PROJECT_ID }) });
    expect(await models.request.getById('req_9')).toEqual(expect.objectContaining({ url: 'https://example.com/pets' }));
  });

  describe('linked', () => {
    beforeEach(async () => {
      await models.workspace.create({ ...workspace, parentId: DEFAULT_PROJECT_ID });
    });

    // what a clone fetches: a commit, with nothing checked out yet
    const fetching = (files: [string, string][]) => jest.spyOn(git, 'clone').mockImplementation(async ({ fs, dir, gitdir }) => {
      const opts = { fs, dir, gitdir };
      await git.init({ ...opts, defaultBranch: 'main' });
      const tree = await treeOf(opts, files);
      const oid = await git.writeCommit({ ...opts, commit: { message: 'from insomnia\n', tree, parent: [], author, committer: author } });
      await git.writeRef({ ...opts, ref: 'refs/heads/main', value: oid });
    });
    const clone = (dataDirName: GitDataDirName) => GitVCS.initFromClone({
      repoId: 'git_1',
      url: 'https://example.com/repo.git',
      directory: GIT_CLONE_DIR,
      fs: layout(dataDirName),
      gitDirectory: GIT_INTERNAL_DIR,
      workspaceId: 'wrk_9',
      dataDirName,
    });
    const files: [string, string][] = [
      [file(LEGACY, workspace), YAML.stringify(workspace)],
      [file(LEGACY, request), YAML.stringify(request)],
    ];

    it('is checked out into the workspace', async () => {
      fetching(files);
      await clone(LEGACY);
      expect(await models.request.getById('req_9')).toEqual(expect.objectContaining({ name: 'pets', parentId: 'wrk_9' }));
      expect(await GitVCS.listFiles()).toEqual([file(LEGACY, request), file(LEGACY, workspace)].map(f => path.normalize(f)));
    });

    it("isn't linked as if it were empty", async () => {
      fetching(files);
      await expect(clone(GIT_INSOMNIA_DIR_NAME)).rejects.toThrow('This repository keeps its data in .insomnia');
      expect(await models.request.getById('req_9')).toBeNull();
    });

    it('keeps its changes there: commits, branches and docs removed on another branch', async () => {
      fetching(files);
      await clone(LEGACY);
      await GitVCS.setAuthor('a', 'a@example.com');
      await GitVCS.checkout('feature');
      const pets = await models.request.getById('req_9');
      await models.request.update(pets!, { name: 'all pets' });
      await models.request.create({ _id: 'req_10', parentId: 'wrk_9' });
      const added = file(LEGACY, { _id: 'req_10', type: models.request.type });
      await GitVCS.add(added);
      await GitVCS.add(file(LEGACY, request));
      await GitVCS.commit('two');
      expect(await GitVCS.workspaceIdsAt('feature')).toEqual(['wrk_9']);
      const opts = { fs: GitVCS.getFs(), dir: GIT_CLONE_DIR, gitdir: GIT_INTERNAL_DIR };
      expect(await git.listFiles({ ...opts, ref: 'feature' })).toEqual([added, file(LEGACY, request), file(LEGACY, workspace)]);
      const committed = await git.readBlob({ ...opts, oid: await git.resolveRef({ ...opts, ref: 'feature' }), filepath: file(LEGACY, request) });
      expect(YAML.parse(Buffer.from(committed.blob).toString()).name).toBe('all pets');

      await GitVCS.checkout('main');
      expect(await db.get(models.request.type, 'req_10')).toBeNull();
      expect((await models.request.getById('req_9'))?.name).toBe('pets');

      await GitVCS.checkout('feature');
      expect(await db.get(models.request.type, 'req_10')).not.toBeNull();
      expect((await models.request.getById('req_9'))?.name).toBe('all pets');
    });
  });
});
