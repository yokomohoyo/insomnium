import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';

import type { GitRepository } from '../../../models/git-repository';
import { MemClient } from '../mem-client';
import { readClonedDocs } from '../ne-db-client';
import { shallowClone } from '../shallow-clone';

const author = { name: 'a', email: 'a@example.com', timestamp: 1, timezoneOffset: 0 };
const REPO_FILE = '[core]\n\tbare = false\n';
const WORKSPACE = 'type: Workspace\n_id: wrk_1\nname: Cloned\n';

describe('shallowClone()', () => {
  afterEach(() => jest.restoreAllMocks());

  it('clones a repository that has a git/config file of its own', async () => {
    // what git.clone does once it has fetched: init, then check out the commit
    jest.spyOn(git, 'clone').mockImplementation(async ({ fs, dir, gitdir }) => {
      const opts = { fs, dir, gitdir };
      const blob = (text: string) => git.writeBlob({ ...opts, blob: Buffer.from(text) });
      const tree = (entries: git.TreeEntry[]) => git.writeTree({ ...opts, tree: entries });
      await git.init({ ...opts, defaultBranch: 'main' });
      const workspaces = await tree([{ mode: '100644', path: 'wrk_1.yml', oid: await blob(WORKSPACE), type: 'blob' }]);
      const root = await tree([
        { mode: '040000', path: '.insomnium', oid: await tree([{ mode: '040000', path: 'Workspace', oid: workspaces, type: 'tree' }]), type: 'tree' },
        { mode: '040000', path: 'git', oid: await tree([{ mode: '100644', path: 'config', oid: await blob(REPO_FILE), type: 'blob' }]), type: 'tree' },
      ]);
      const commit = await git.writeCommit({ ...opts, commit: { message: 'one\n', tree: root, parent: [], author, committer: author } });
      await git.writeRef({ ...opts, ref: 'refs/heads/main', value: commit });
      await git.checkout({ ...opts, ref: 'main' });
    });
    const fsClient = MemClient.createClient();

    await shallowClone({ fsClient, gitRepository: { uri: 'https://github.com/owner/repo.git', credentials: null } as GitRepository });

    expect((await readClonedDocs(fsClient)).map(doc => doc._id)).toEqual(['wrk_1']);
    expect((await fsClient.promises.readFile('git/config')).toString()).toBe(REPO_FILE);
  });
});
