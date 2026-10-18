import * as git from 'isomorphic-git';
import path from 'path';
import YAML from 'yaml';

import { database as db } from '../../common/database';
import * as models from '../../models';
import type { BaseModel } from '../../models';
import { httpClient } from './http-client';
import { describeDoc, type DocConflict, isSyncedDoc, type MergeChoice, mergeDoc } from './merge-docs';
import { mergeLines } from './line-merge';
import { convertToOsSep, convertToPosixSep } from './path-sep';
import { sameFile } from './same-file';
import { sanitizeGitConfig } from './sanitize-git-config';
import { gitCallbacks } from './utils';

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitRemoteConfig {
  remote: string;
  url: string;
}

interface GitCredentialsBase {
  username: string;
  password: string;
}

interface GitCredentialsOAuth {
  /**
   * Supported OAuth formats.
   * This is needed by isomorphic-git to be able to push/pull using an oauth2 token.
   * https://isomorphic-git.org/docs/en/authentication.html
   */
  oauth2format?: 'github' | 'gitlab';
  username: string;
  token: string;
}

export type GitCredentials = GitCredentialsBase | GitCredentialsOAuth;

export const isGitCredentialsOAuth = (
  credentials: GitCredentials
): credentials is GitCredentialsOAuth => {
  return 'oauth2format' in credentials;
};

export type GitHash = string;

export type GitRef = GitHash | string;

export interface GitTimestamp {
  timezoneOffset: number;
  timestamp: number;
}

export interface GitLogEntry {
  oid: string;
  commit: {
    message: string;
    tree: GitRef;
    author: GitAuthor & GitTimestamp;
    committer: GitAuthor & GitTimestamp;
    parent: GitRef[];
  };
  payload: string;
}

interface InitOptions {
  directory: string;
  fs: git.FsClient;
  gitDirectory?: string;
  gitCredentials?: GitCredentials | null;
  uri?: string;
  repoId: string;
  dataDirName?: GitDataDirName;
}

interface InitFromCloneOptions {
  url: string;
  gitCredentials?: GitCredentials | null;
  directory: string;
  fs: git.FsClient;
  gitDirectory: string;
  repoId: string;
  // the workspace being linked: a repository holding another one is refused
  workspaceId?: string;
  dataDirName?: GitDataDirName;
}

/**
 * isomorphic-git internally will default an empty ('') clone directory to '.'
 *
 * Ref: https://github.com/isomorphic-git/isomorphic-git/blob/4e66704d05042624bbc78b85ee5110d5ee7ec3e2/src/utils/normalizePath.js#L10
 *
 * We should set this explicitly (even if set to an empty string), because we have other code (such as fs clients and unit tests) that depend on the clone directory.
 */
export const GIT_CLONE_DIR = '.';
export const GIT_INSOMNIA_DIR_NAME = '.insomnium';
// Where Insomnia (and Insomnium before its rename) keeps a repository's data.
// A repository cloned with its data there keeps it there, so it can still be
// shared with Insomnia users.
export const GIT_INSOMNIA_LEGACY_DIR_NAME = '.insomnia';
export const GIT_DATA_DIR_NAMES = [GIT_INSOMNIA_DIR_NAME, GIT_INSOMNIA_LEGACY_DIR_NAME] as const;
export type GitDataDirName = typeof GIT_DATA_DIR_NAMES[number];
// Absolute, so no work-tree path (always relative to GIT_CLONE_DIR) can name
// it: a repository file at git/config must not land in the real git config.
// fsClient joins it under the repo folder, the same place on disk as before.
export const GIT_INTERNAL_DIR = '/git';
export const GIT_INSOMNIA_DIR = path.join(GIT_CLONE_DIR, GIT_INSOMNIA_DIR_NAME);

// The _ids of the workspaces among a commit's files (a file is named for its doc)
const workspaceIdsIn = (files: string[], dataDirName: string) => {
  const prefix = `${dataDirName}/Workspace/`;
  return files
    .filter(file => file.startsWith(prefix) && file.endsWith('.yml') && !file.slice(prefix.length).includes('/'))
    .map(file => file.slice(prefix.length, -'.yml'.length));
};

interface BaseOpts {
  dir: string;
  gitdir?: string;
  fs: git.CallbackFsClient | git.PromiseFsClient;
  http: git.HttpClient;
  onMessage: (message: string) => void;
  onAuthFailure: git.AuthFailureCallback;
  onAuthSuccess: git.AuthSuccessCallback;
  onAuth: git.AuthCallback;
  uri: string;
  repoId: string;
}

// what a pull, merge or switch of branch would write over: changes here that
// were never committed, to documents (or files) it brings changes to
export class GitLocalChangesError extends Error {
  files: string[];

  constructor(doing: string, files: string[], names: string[]) {
    const listed = names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '');
    super(`${doing} would overwrite changes that aren't committed yet: ${listed}. Commit them, or undo them, and try again.`);
    this.name = 'GitLocalChangesError';
    this.files = files;
  }
}

// the documents both sides of a merge changed, with the fields that clash
export class GitConflictsError extends Error {
  conflicts: DocConflict[];

  constructor(conflicts: DocConflict[]) {
    super(`Both sides changed ${conflicts.map(conflict => conflict.name || conflict.file).join(', ')}: choose which to keep.`);
    this.name = 'GitConflictsError';
    this.conflicts = conflicts;
  }
}

export class GitVCS {
  // @ts-expect-error -- TSCONVERSION not initialized with required properties
  _baseOpts: BaseOpts = gitCallbacks();

  initializedRepoId = '';

  // the repository's folder for the app's data, at its root
  dataDirName: GitDataDirName = GIT_INSOMNIA_DIR_NAME;

  async init({ directory, fs, gitDirectory, gitCredentials, uri = '', repoId, dataDirName = GIT_INSOMNIA_DIR_NAME }: InitOptions) {
    this.dataDirName = dataDirName;
    this._baseOpts = {
      ...this._baseOpts,
      dir: directory,
      ...gitCallbacks(gitCredentials),
      gitdir: gitDirectory,
      fs,
      http: httpClient,
      uri,
      repoId,
    };

    if (await this.repoExists()) {
      console.log(`[git] Opened repo for ${gitDirectory}`);
      // keep only the config Insomnium writes (see sanitize-git-config.ts)
      const { promises: fs } = this._baseOpts.fs as git.PromiseFsClient;
      const configPath = `${gitDirectory}/config`;
      const config = (await fs.readFile(configPath, 'utf8').catch(() => '')).toString();
      const sanitized = sanitizeGitConfig(config);
      if (config && sanitized !== config) {
        console.warn('[git] Removing settings Insomnium does not write from the repository config');
        await fs.writeFile(configPath, sanitized);
      }
    } else {
      console.log(`[git] Initialized repo in ${gitDirectory}`);
      let defaultBranch = 'main';

      try {
        const url = await this.getRemoteOriginURI();
        if (!url) {
          throw new Error('No remote origin URL');
        }
        const [mainRef] = await git.listServerRefs({
          ...this._baseOpts,
          url,
          prefix: 'HEAD',
          symrefs: true,
        });

        defaultBranch = mainRef?.target?.replace('refs/heads/', '') || 'main';
      } catch (err) {
        // Ignore error
      }

      await git.init({ ...this._baseOpts, defaultBranch });
    }
  }

  async getRemoteOriginURI() {
    try {
      const remoteOriginURI = await git.getConfig({
        ...this._baseOpts,
        path: 'remote.origin.url',
      });

      return remoteOriginURI;
    } catch (err) {
      // Ignore error
      return this._baseOpts.uri || '';
    }
  }

  async initFromClone({
    repoId,
    url,
    gitCredentials,
    directory,
    fs,
    gitDirectory,
    workspaceId,
    dataDirName = GIT_INSOMNIA_DIR_NAME,
  }: InitFromCloneOptions) {
    this.dataDirName = dataDirName;
    this._baseOpts = {
      ...this._baseOpts,
      ...gitCallbacks(gitCredentials),
      dir: directory,
      gitdir: gitDirectory,
      fs,
      http: httpClient,
      repoId,
    };
    // fetched first, and only checked out (written into the workspace) once
    // it's known to hold this workspace or none
    await git.clone({
      ...this._baseOpts,
      url,
      singleBranch: true,
      noCheckout: true,
    });
    const branch = await git.currentBranch({ ...this._baseOpts });
    const hasCommits = !!branch && await git.resolveRef({ ...this._baseOpts, ref: branch }).then(() => true, () => false);
    if (!branch || !hasCommits) {
      // an empty repository: nothing to check out
      console.log(`[git] Cloned an empty repo to ${gitDirectory} from ${url}`);
      return;
    }
    const files = await git.listFiles({ ...this._baseOpts, ref: branch });
    const held = workspaceIdsIn(files, dataDirName);
    const elsewhere = GIT_DATA_DIR_NAMES.find(dir => dir !== dataDirName && workspaceIdsIn(files, dir).length);
    if (!held.length && elsewhere) {
      throw new Error(`This repository keeps its data in ${elsewhere}, so it can't be linked to this workspace. To open it, clone it from the project instead (Clone Git Repository).`);
    }
    if (workspaceId) {
      if (held.length && !held.includes(workspaceId)) {
        throw new Error('This repository holds a different workspace, so it can\'t be linked to this one. To open it, clone it from the project instead (Clone Git Repository), which adds it as its own workspace.');
      }
    }
    await git.checkout({ ...this._baseOpts, ref: branch });
    console.log(`[git] Clones repo to ${gitDirectory} from ${url}`);
  }

  // The _ids of the workspaces a commit holds
  async workspaceIdsAt(ref: string) {
    return workspaceIdsIn(await git.listFiles({ ...this._baseOpts, ref }), this.dataDirName);
  }

  isInitializedForRepo(id: string) {
    return this._baseOpts.repoId === id;
  }

  async listFiles() {
    console.log('[git] List files');
    const repositoryFiles = await git.listFiles({ ...this._baseOpts });
    const insomniaFiles = repositoryFiles
      .filter(file => file.startsWith(`${this.dataDirName}/`))
      .map(convertToOsSep);
    return insomniaFiles;
  }

  async getBranch() {
    const branch = await git.currentBranch({ ...this._baseOpts });

    if (typeof branch !== 'string') {
      throw new Error('No active branch');
    }

    return branch;
  }

  async listBranches() {
    const branch = await this.getBranch();
    const branches = await git.listBranches({ ...this._baseOpts });

    // For some reason, master isn't in branches on fresh repo (no commits)
    if (!branches.includes(branch)) {
      branches.push(branch);
    }

    console.log(
      `[git] Local branches: ${branches.join(', ')} (current: ${branch})`
    );

    return GitVCS.sortBranches(branches);
  }

  async listRemoteBranches() {
    const branches = await git.listBranches({
      ...this._baseOpts,
      remote: 'origin',
    });
    // Don't care about returning remote HEAD
    return GitVCS.sortBranches(branches.filter(b => b !== 'HEAD'));
  }

  async fetchRemoteBranches() {
    const uri = await this.getRemoteOriginURI();
    try {
      const branches = await git.listServerRefs({
        ...this._baseOpts,
        prefix: 'refs/heads/',
        url: uri,
      });
      console.log({ branches });
      // Don't care about returning remote HEAD
      return GitVCS.sortBranches(
        branches
          .filter(b => b.ref !== 'HEAD')
          .map(b => b.ref.replace('refs/heads/', ''))
      );
    } catch (e) {
      console.log(`[git] Failed to list remote branches for ${uri}`, e);
      return [];
    }
  }

  async status(filepath: string) {
    return git.status({
      ...this._baseOpts,
      filepath: convertToPosixSep(filepath),
    });
  }

  async add(relPath: string) {
    relPath = convertToPosixSep(relPath);
    console.log(`[git] Add ${relPath}`);
    return git.add({ ...this._baseOpts, filepath: relPath });
  }

  async remove(relPath: string) {
    relPath = convertToPosixSep(relPath);
    console.log(`[git] Remove relPath=${relPath}`);
    return git.remove({ ...this._baseOpts, filepath: relPath });
  }

  async addRemote(url: string) {
    console.log(`[git] Add Remote url=${url}`);
    await git.addRemote({
      ...this._baseOpts,
      remote: 'origin',
      url,
      force: true,
    });
    const config = await this.getRemote('origin');

    if (config === null) {
      throw new Error('Remote not found remote=origin');
    }

    return config;
  }

  async listRemotes(): Promise<GitRemoteConfig[]> {
    return git.listRemotes({ ...this._baseOpts });
  }

  async getAuthor() {
    const name = await git.getConfig({ ...this._baseOpts, path: 'user.name' });
    const email = await git.getConfig({
      ...this._baseOpts,
      path: 'user.email',
    });
    return {
      name: name || '',
      email: email || '',
    } as GitAuthor;
  }

  async setAuthor(name: string, email: string) {
    await git.setConfig({ ...this._baseOpts, path: 'user.name', value: name });
    await git.setConfig({
      ...this._baseOpts,
      path: 'user.email',
      value: email,
    });
  }

  async getRemote(name: string): Promise<GitRemoteConfig | null> {
    const remotes = await this.listRemotes();
    return remotes.find(r => r.remote === name) || null;
  }

  async commit(message: string) {
    console.log(`[git] Commit "${message}"`);
    return git.commit({ ...this._baseOpts, message });
  }

  /**
   * Check to see whether remote is different than local. This is here because
   * when pushing with isomorphic-git, if the HEAD of local is equal the HEAD
   * of remote, it will fail with a non-fast-forward message.
   *
   * @param gitCredentials
   * @returns {Promise<boolean>}
   */
  async canPush(gitCredentials?: GitCredentials | null): Promise<boolean> {
    const branch = await this.getBranch();
    const remote = await this.getRemote('origin');

    if (!remote) {
      throw new Error('Remote not configured');
    }

    const remoteInfo = await git.getRemoteInfo({
      ...this._baseOpts,
      ...gitCallbacks(gitCredentials),
      forPush: true,
      url: remote.url,
    });
    const logs = (await this.log({ depth: 1 })) || [];
    const localHead = logs[0].oid;
    const remoteRefs = remoteInfo.refs || {};
    const remoteHeads = remoteRefs.heads || {};
    const remoteHead = remoteHeads[branch];

    if (localHead === remoteHead) {
      return false;
    }

    return true;
  }

  async push(gitCredentials?: GitCredentials | null, force = false) {
    console.log(`[git] Push remote=origin force=${force ? 'true' : 'false'}`);
    // eslint-disable-next-line no-unreachable
    const response: git.PushResult = await git.push({
      ...this._baseOpts,
      ...gitCallbacks(gitCredentials),
      remote: 'origin',
      force,
    });

    // @ts-expect-error -- TSCONVERSION git errors are not handled correctly
    if (response.errors?.length) {
      console.log('[git] Push rejected', response);
      // @ts-expect-error -- TSCONVERSION git errors are not handled correctly
      const errorsString = JSON.stringify(response.errors);
      throw new Error(
        `Push rejected with errors: ${errorsString}.\n\nGo to View > Toggle DevTools > Console for more information.`
      );
    }
  }

  async pull(gitCredentials?: GitCredentials | null, choices: Record<string, MergeChoice> = {}) {
    const branch = await this.getBranch();
    console.log('[git] Pull remote=origin', branch);
    // git.pull's steps (fetch, merge, check out), with a look before the merge
    // moves the branch: what came mustn't land on changes never committed
    const { fetchHead, fetchHeadDescription } = await git.fetch({
      ...this._baseOpts,
      ...gitCallbacks(gitCredentials),
      remote: 'origin',
      ref: branch,
      singleBranch: true,
    });
    if (!fetchHead) {
      return;
    }
    await this._refuseOverwritingLocalChanges(fetchHead, 'Pulling');
    try {
      return await this._removingDroppedDocs(async () => {
        await git.merge({
          ...this._baseOpts,
          ours: branch,
          theirs: fetchHead,
          message: `Merge ${fetchHeadDescription}`,
        });
        await git.checkout({
          ...this._baseOpts,
          ref: branch,
          remote: 'origin',
        });
      });
    } catch (err) {
      // a clash a merge of the files' lines can't settle: merge what was
      // fetched a document's fields at a time
      if (!(err instanceof git.Errors.MergeConflictError)) {
        throw err;
      }
      return this.mergeByField(`refs/remotes/origin/${branch}`, choices);
    }
  }

  /**
   * Merges theirs into the current branch, a document's fields at a time
   * (merge-docs.ts), then brings the work tree, and so the app, up to the merge.
   * choices, by file name, decide the fields both sides changed; without one, a
   * GitConflictsError lists them.
   */
  async mergeByField(theirs: string, choices: Record<string, MergeChoice> = {}) {
    const ours = await this.getBranch();
    console.log(`[git] Merge ${ours} <-- ${theirs}`);
    await this._refuseOverwritingLocalChanges(theirs, `Merging ${theirs.replace(/^refs\/remotes\/origin\//, '')}`);
    const conflicts: DocConflict[] = [];
    // the synced documents by field; the repository's other files by line, as git would
    const merge = () => git.merge({
      ...this._baseOpts,
      ours,
      theirs,
      abortOnConflict: true,
      mergeDriver: ({ contents: [base, mine, yours], path: file }) => {
        if (!isSyncedDoc(file, mine, yours)) {
          const lines = mergeLines(base, mine, yours, [ours, theirs]);
          if (lines.cleanMerge) {
            return lines;
          }
          if (choices[file]) {
            return { cleanMerge: true, mergedText: choices[file] === 'ours' ? mine : yours };
          }
          conflicts.push({ file, name: file, type: 'File', fields: [{ field: '(file)' }] });
          return { cleanMerge: false, mergedText: mine };
        }
        const { merged, conflicts: fields } = mergeDoc(base, mine, yours, choices[file]);
        if (merged === undefined) {
          conflicts.push({ file, ...describeDoc(mine, yours), fields });
          return { cleanMerge: false, mergedText: mine };
        }
        return { cleanMerge: true, mergedText: merged };
      },
    });
    try {
      // the merge moves the branch, so what it dropped is seen against where it was
      return await this._removingDroppedDocs(async () => {
        const result = await merge();
        await git.checkout({
          ...this._baseOpts,
          ref: ours,
          remote: 'origin',
        });
        return result;
      });
    } catch (err) {
      if (err instanceof git.Errors.MergeConflictError && conflicts.length) {
        throw new GitConflictsError(conflicts);
      }
      if (err instanceof git.Errors.MergeNotSupportedError) {
        throw new Error("Something was deleted on one side and changed on the other, which can't be merged yet. Undo the delete or the change on one side, commit, and merge again.");
      }
      throw err;
    }
  }

  /**
   * isomorphic-git never sees the synced docs in the work tree (the root listing
   * comes from the 'other' store), so a checkout only drops a doc the incoming
   * commit no longer has from the index, and the doc stays in the app. Remove
   * those docs too, unless they have changes that were never committed (they
   * then show as added) or something still in the app sits under them. The
   * workspace always stays.
   */
  async _removingDroppedDocs<T>(operation: () => Promise<T>) {
    const head = await git.resolveRef({ ...this._baseOpts, ref: 'HEAD' }).catch(() => null);
    const before = await git.listFiles({ ...this._baseOpts });
    const result = await operation();
    if (!head) {
      return result;
    }

    const after = new Set(await git.listFiles({ ...this._baseOpts }));
    const { promises: fs } = this._baseOpts.fs as git.PromiseFsClient;
    const workspaceIds = new Set<string>();
    const dropped = new Map<string, BaseModel>();
    for (const filepath of before) {
      const [root, type, fileName, ...rest] = filepath.split('/');
      if (root !== this.dataDirName || !fileName || rest.length) {
        continue;
      }
      if (type === models.workspace.type) {
        workspaceIds.add(fileName.replace(/\.yml$/, ''));
        continue;
      }
      if (after.has(filepath) || !models.getModel(type)?.canSync) {
        continue;
      }
      const committed = await git.readBlob({ ...this._baseOpts, oid: head, filepath }).catch(() => null);
      const content = await fs.readFile(filepath).catch(() => null);
      // only staged, or not in the app
      if (!committed || !content) {
        continue;
      }
      if (!(await sameFile(filepath, content, committed.blob, this.dataDirName))) {
        console.log(`[git] Keeping ${filepath}, removed upstream: it has changes that were not committed`);
        continue;
      }
      const doc: BaseModel = YAML.parse(content.toString());
      dropped.set(doc._id, doc);
    }

    for (const { _id, type } of dropped.values()) {
      // already gone if it was under another dropped doc
      const doc = await db.get(type, _id);
      if (!doc) {
        continue;
      }
      if (!(await db.withAncestors(doc)).some(d => d.type === models.workspace.type && workspaceIds.has(d._id))) {
        console.log(`[git] Keeping ${type} ${_id}, removed upstream: it is not under this repository's workspace`);
        continue;
      }
      const kept = (await db.withDescendants(doc)).find(d => !dropped.has(d._id) && models.getModel(d.type)?.canSync);
      if (kept) {
        console.log(`[git] Keeping ${type} ${_id}, removed upstream: ${kept.type} ${kept._id} is under it`);
        continue;
      }
      console.log(`[git] Removing ${type} ${_id}: removed upstream`);
      await db.remove(doc, true);
    }
    return result;
  }

  /**
   * isomorphic-git can't see the synced docs in the work tree (see
   * _removingDroppedDocs), so it writes what comes in over changes that were
   * never committed, where git would refuse. Refuse first, before a merge
   * moves the branch: for each file theirs adds or changes (since the merge
   * base, or since HEAD for a switch of branch) that is here neither as
   * committed nor as it comes. What theirs deletes passes: a doc with changes
   * here stays (_removingDroppedDocs).
   */
  async _refuseOverwritingLocalChanges(theirs: string, doing: string, since: 'base' | 'head' = 'base') {
    const head = await git.resolveRef({ ...this._baseOpts, ref: 'HEAD' }).catch(() => null);
    const incoming = await git.resolveRef({ ...this._baseOpts, ref: theirs }).catch(() => null);
    if (!head || !incoming || head === incoming) {
      return;
    }
    let from = head;
    if (since === 'base') {
      const [base] = await git.findMergeBase({ ...this._baseOpts, oids: [head, incoming] }).catch(() => []);
      // a shallow history may not reach one: then all that differs from HEAD
      from = base || head;
    }
    if (from === incoming) {
      return;
    }

    const { promises: fs } = this._baseOpts.fs as git.PromiseFsClient;
    const changed: [string, string][] = [];
    await git.walk({
      ...this._baseOpts,
      trees: [git.TREE({ ref: from }), git.TREE({ ref: incoming })],
      map: async (filepath, [before, after]) => {
        const [was, comes] = [await before?.oid(), await after?.oid()];
        if (was !== comes && (await after?.type()) === 'blob') {
          changed.push([filepath, comes as string]);
        }
        // a folder that's the same isn't walked
        return was === comes ? null : true;
      },
    });

    const clashes: string[] = [];
    const names: string[] = [];
    for (const [filepath, oid] of changed) {
      const content: Uint8Array | null = await fs.readFile(filepath).catch(() => null);
      const committed = (await git.readBlob({ ...this._baseOpts, oid: head, filepath }).catch(() => null))?.blob ?? null;
      if (await sameFile(filepath, content, committed, this.dataDirName)) {
        continue;
      }
      if (await sameFile(filepath, content, (await git.readBlob({ ...this._baseOpts, oid })).blob, this.dataDirName)) {
        continue;
      }
      clashes.push(filepath);
      const [root, type] = filepath.split('/');
      const shown = content || committed;
      if (root === this.dataDirName && shown) {
        const { name } = describeDoc(Buffer.from(shown).toString());
        const typeName = models.getModel(type)?.name || type;
        names.push(`${name || path.basename(filepath, '.yml')} (${typeName}${content ? '' : ', deleted here'})`);
      } else {
        names.push(content ? filepath : `${filepath} (deleted here)`);
      }
    }
    if (clashes.length) {
      console.log(`[git] ${doing} would overwrite changes that were never committed`, clashes);
      throw new GitLocalChangesError(doing, clashes, names);
    }
  }

  async merge(theirBranch: string) {
    const ours = await this.getBranch();
    console.log(`[git] Merge ${ours} <-- ${theirBranch}`);
    return git.merge({
      ...this._baseOpts,
      ours,
      theirs: theirBranch,
    });
  }

  async fetch({
    singleBranch,
    depth,
    credentials,
    relative = false,
  }: {
    singleBranch: boolean;
    depth?: number;
    credentials?: GitCredentials | null;
    relative?: boolean;
  }) {
    console.log('[git] Fetch remote=origin');
    return git.fetch({
      ...this._baseOpts,
      ...gitCallbacks(credentials),
      singleBranch,
      remote: 'origin',
      relative,
      depth,
      prune: true,
      pruneTags: true,

    });
  }

  async log(input: {depth?: number} = {}) {
    const { depth = 35 } = input;
    try {
      const remoteOriginURI = await this.getRemoteOriginURI();
      if (remoteOriginURI) {
        await git.fetch({
          ...this._baseOpts,
          remote: 'origin',
          depth,
          singleBranch: true,
          tags: false,
        });
      }

      return await git.log({ ...this._baseOpts, depth });
    } catch (error: unknown) {
      if (error instanceof git.Errors.NotFoundError) {
        return [];
      }

      throw error;
    }
  }

  async branch(branch: string, checkout = false) {
    console.log('[git] Branch', {
      branch,
      checkout,
    });

    await git.branch({
      ...this._baseOpts,
      ref: branch,
      checkout,
      // @ts-expect-error -- TSCONVERSION remote doesn't exist as an option
      remote: 'origin',
    });
  }

  async deleteBranch(branch: string) {
    await git.deleteBranch({ ...this._baseOpts, ref: branch });
  }

  async checkout(branch: string) {
    console.log('[git] Checkout', {
      branch,
    });
    const localBranches = await this.listBranches();
    const syncedBranches = await this.listRemoteBranches();
    const remoteBranches = await this.fetchRemoteBranches();
    const branches = [...localBranches, ...syncedBranches, ...remoteBranches];
    console.log('[git] Checkout branches', { branches, branch });

    if (branches.includes(branch)) {
      try {
        if (!syncedBranches.includes(branch)) {
          console.log('[git] Fetching branch', branch);
          // Try to fetch the branch from the remote if it doesn't exist locally;
          await git.fetch({
            ...this._baseOpts,
            remote: 'origin',
            depth: 1,
            ref: branch,
            singleBranch: true,
            tags: false,
          });
        }
      } catch (e) {
        console.log('[git] Fetch failed', e);
      }

      // the branch as it's checked out: the local one, or else the remote's
      const target = await git.resolveRef({ ...this._baseOpts, ref: `refs/heads/${branch}` })
        .catch(() => git.resolveRef({ ...this._baseOpts, ref: `refs/remotes/origin/${branch}` }))
        .catch(() => null);
      if (target) {
        await this._refuseOverwritingLocalChanges(target, `Switching to ${branch}`, 'head');
      }
      await this._removingDroppedDocs(() => git.checkout({
        ...this._baseOpts,
        ref: branch,
        remote: 'origin',
      }));
      const branches = await this.listBranches();
      console.log('[git] Checkout branches', { branches });
    } else {
      await this.branch(branch, true);
    }
  }

  async undoPendingChanges(fileFilter?: string[]) {
    console.log('[git] Undo pending changes');
    await git.checkout({
      ...this._baseOpts,
      ref: await this.getBranch(),
      remote: 'origin',
      force: true,
      filepaths: fileFilter?.map(convertToPosixSep),
    });
  }

  async readObjFromTree(treeOid: string, objPath: string) {
    try {
      const obj = await git.readObject({
        ...this._baseOpts,
        oid: treeOid,
        filepath: convertToPosixSep(objPath),
        encoding: 'utf8',
      });
      return obj.object;
    } catch (err) {
      return null;
    }
  }

  // a file as it is now, in the working tree (for the database's documents,
  // as NeDBClient writes them), or null when there's none
  async readWorkingFile(relPath: string) {
    try {
      const { promises: fs } = this._baseOpts.fs as git.PromiseFsClient;
      return (await fs.readFile(path.join(this._baseOpts.dir, relPath), 'utf8')).toString();
    } catch (err) {
      return null;
    }
  }

  async repoExists() {
    try {
      await git.getConfig({ ...this._baseOpts, path: '' });
    } catch (err) {
      return false;
    }

    return true;
  }

  getFs() {
    return this._baseOpts.fs;
  }

  static sortBranches(branches: string[]) {
    const newBranches = [...branches];
    newBranches.sort((a: string, b: string) => {
      if (a === 'master') {
        return -1;
      } else if (b === 'master') {
        return 1;
      } else {
        return b > a ? -1 : 1;
      }
    });
    return newBranches;
  }
}

export default new GitVCS();
