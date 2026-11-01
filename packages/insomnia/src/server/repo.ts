// `--repo`: a Git Sync repository, served as the app has it.
//
// A URL is cloned, and fetched again on each update, into a folder of its own,
// laid out as the app lays out a clone: the work tree and the git dir apart,
// and paths that would leave either refused (fs-client.ts, routable-fs-client.ts).
// The folder is removed when the repository is closed.
// A directory is a checkout something else keeps current, such as a mounted
// volume, and is read again on each update: its own folders and regular files
// only, never through a link (checkoutClient). Either way, only the repository's
// synced documents are read, by the rules a clone in the app keeps to
// (readClonedDocs), and nothing is written back.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import { database as db } from '../common/database';
import * as models from '../models';
import type { BaseModel } from '../models';
import { DEFAULT_PROJECT_ID } from '../models/project';
import { isWorkspace, type Workspace, WorkspaceScopeKeys } from '../models/workspace';
import { fsClient } from '../sync/git/fs-client';
import { GIT_CLONE_DIR, GIT_INTERNAL_DIR } from '../sync/git/git-vcs';
import { clonedDataDir, readClonedDocs } from '../sync/git/ne-db-client';
import { routableFSClient } from '../sync/git/routable-fs-client';

export interface RepoOptions {
  // a cloned repository's branch; its default one otherwise
  branch?: string;
  // for a private repository: a token, and the username to send it with
  token?: string;
  username?: string;
  // the host the token is for, when it's set: none goes anywhere else
  tokenHost?: string;
}

export interface Repo {
  // where it's from, as printed: a URL without a username or token in it
  location: string;
  // brings the repository up to date (a fetch, for a clone)
  update(): Promise<void>;
  // its synced documents, and what they're from: a commit, or a checksum of a directory's
  read(): Promise<{ docs: BaseModel[]; version: string }>;
  // removes a clone's folder; a directory is left as it is
  close(): void;
}

export const isRemoteRepo = (location: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(location) || /^[\w.-]+@[^:/\s]+:/.test(location);

// A URL as given may carry a username and token (https://user:token@host/…),
// which logs and errors leave out
export const withoutUserinfo = (location: string) => location.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');

const readDocs = async (client: git.PromiseFsClient, location: string) => {
  const dataDirName = await clonedDataDir(client);
  if (!dataDirName) {
    throw new Error(`${location} has no Insomnium workspace (a .insomnium or .insomnia folder with a Workspace in it)`);
  }
  return readClonedDocs(client, dataDirName);
};

async function cloneRepo(url: string, options: RepoOptions): Promise<Repo> {
  const location = withoutUserinfo(url);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`${location}: only http(s) Git remotes can be cloned; mount a checkout and give its directory instead`);
  }
  const { protocol, hostname, host } = new URL(url);
  if (options.token && protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new Error(`${location}: INSOMNIUM_GIT_TOKEN would go over plain HTTP: use an https:// URL`);
  }
  if (options.token && options.tokenHost && options.tokenHost.toLowerCase() !== host.toLowerCase()) {
    throw new Error(`${location}: INSOMNIUM_GIT_TOKEN is for ${options.tokenHost} (INSOMNIUM_GIT_TOKEN_HOST), not ${host}`);
  }
  // the token only for the repository's own host, wherever a redirect goes
  const tokenFor = (asked: string) => {
    try {
      return new URL(asked).host.toLowerCase() === host.toLowerCase();
    } catch {
      return false;
    }
  };
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'insomnium-repo-'));
  const close = () => fs.rmSync(base, { recursive: true, force: true });
  const workTree = fsClient(path.join(base, 'work'));
  const opts = {
    fs: routableFSClient(workTree, { [GIT_INTERNAL_DIR]: fsClient(base) }),
    http,
    dir: GIT_CLONE_DIR,
    gitdir: GIT_INTERNAL_DIR,
    onAuth: (asked: string) => (options.token && tokenFor(asked) ? { username: options.username || 'git', password: options.token } : { cancel: true }),
  };
  let branch: string;
  try {
    await git.clone({ ...opts, url, ...(options.branch ? { ref: options.branch } : {}), singleBranch: true });
    const current = await git.currentBranch({ ...opts });
    if (!current) {
      throw new Error(`${location} has no commits`);
    }
    branch = current;
  } catch (err) {
    close();
    throw err;
  }
  return {
    location,
    close,
    async update() {
      const { fetchHead } = await git.fetch({ ...opts, ref: branch, singleBranch: true });
      const head = await git.resolveRef({ ...opts, ref: 'HEAD' });
      if (!fetchHead || fetchHead === head) {
        return;
      }
      // nothing changes here, so the branch just moves to what was fetched
      await git.writeRef({ ...opts, ref: `refs/heads/${branch}`, value: fetchHead, force: true });
      await git.checkout({ ...opts, ref: branch, force: true });
    },
    async read() {
      return { docs: await readDocs(workTree, location), version: await git.resolveRef({ ...opts, ref: 'HEAD' }) };
    },
  };
}

// a synced document is a few kilobytes; a bigger file than this in a checkout
// is refused rather than read into memory
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// A mounted checkout, read only: its own folders and regular files, never a
// link, and nothing whose real path is outside it. (A clone stores a link as a
// plain file; a checkout made by git has real ones.)
function checkoutClient(root: string): git.PromiseFsClient {
  const realRoot = fs.realpathSync(root);
  const entry = async (filePath: string) => {
    const full = path.join(realRoot, path.normalize(filePath));
    const real = await fs.promises.realpath(full);
    const relative = path.relative(realRoot, real);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Refusing ${filePath}: outside ${root}`);
    }
    return { real, stat: await fs.promises.lstat(full) };
  };
  const readOnly = async (filePath: string) => {
    throw new Error(`Refusing to change ${filePath} in ${root}: a checkout is only read`);
  };
  return {
    promises: {
      async readdir(filePath: string) {
        const { real, stat } = await entry(filePath);
        if (!stat.isDirectory()) {
          throw new Error(`Refusing ${filePath} in ${root}: not a folder`);
        }
        const entries = await fs.promises.readdir(real, { withFileTypes: true });
        return entries.filter(dirent => dirent.isDirectory() || dirent.isFile()).map(dirent => dirent.name);
      },
      async readFile(filePath: string) {
        const { real, stat } = await entry(filePath);
        if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
          throw new Error(`Refusing ${filePath} in ${root}: ${stat.isFile() ? 'larger than 10 MB' : 'not a regular file'}`);
        }
        const handle = await fs.promises.open(real, 'r');
        try {
          // no more than its size when checked, should it have grown since
          const { buffer, bytesRead } = await handle.read(Buffer.alloc(stat.size), 0, stat.size, 0);
          return buffer.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      },
      stat: async (filePath: string) => (await entry(filePath)).stat,
      lstat: async (filePath: string) => (await entry(filePath)).stat,
      writeFile: readOnly,
      unlink: readOnly,
      mkdir: readOnly,
      rmdir: readOnly,
    },
  };
}

function directoryRepo(directory: string): Repo {
  const resolved = path.resolve(directory);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${directory} is not a directory, nor a Git URL`);
  }
  const client = checkoutClient(resolved);
  return {
    location: directory,
    async update() {},
    async read() {
      const docs = await readDocs(client, directory);
      return { docs, version: crypto.createHash('sha256').update(JSON.stringify(docs)).digest('hex') };
    },
    close() {},
  };
}

export const openRepo = (location: string, options: RepoOptions = {}): Promise<Repo> =>
  isRemoteRepo(location) ? cloneRepo(location, options) : Promise.resolve(directoryRepo(location));

const syncedTypes = () => new Set<string>(models.all().filter(model => model.canSync).map(model => model.type));

/**
 * The repository's workspace into the database, or brought up to date there.
 * Documents it adds or changes are written; ones it no longer has are removed,
 * with what hangs off them (a request's responses). The ones it still has keep
 * their responses. As in a clone (importClonedDocs), a document whose parents
 * lead outside the repository's workspace, or whose _id belongs to something
 * else in the database, is left out.
 */
export async function syncRepoDocs(docs: BaseModel[], location: string): Promise<Workspace> {
  const workspaces = docs.filter(isWorkspace);
  if (workspaces.length !== 1) {
    throw new Error(`${location} has ${workspaces.length ? 'more than one workspace' : 'no workspace'}; a Git Sync repository holds one`);
  }
  const [workspace] = workspaces;
  const byId = new Map(docs.map(doc => [doc._id, doc]));
  const inRepository = (doc: BaseModel) => {
    const seen = new Set<string>();
    for (let current: BaseModel | undefined = doc; current; current = byId.get(current.parentId)) {
      if (current._id === workspace._id) {
        return true;
      }
      if (seen.has(current._id)) {
        return false;
      }
      seen.add(current._id);
    }
    return false;
  };

  const types = syncedTypes();
  const loaded = await models.workspace.getById(workspace._id);
  const present = new Map((loaded ? await db.withDescendants(loaded) : []).filter(doc => types.has(doc.type)).map(doc => [doc._id, doc]));
  const kept = new Set<string>();
  for (const doc of docs.filter(inRepository)) {
    if (!present.has(doc._id) && await db.get(doc.type, doc._id)) {
      console.warn(`[repo] ${location}: leaving out ${doc.type} ${doc._id}, which is something else's`);
      continue;
    }
    const value = isWorkspace(doc)
      ? { ...doc, parentId: DEFAULT_PROJECT_ID, scope: doc.scope === WorkspaceScopeKeys.collection ? WorkspaceScopeKeys.collection : WorkspaceScopeKeys.design }
      : doc;
    await db.upsert(value, true);
    kept.add(doc._id);
  }
  for (const [id, doc] of present) {
    // (unless it went with a folder removed before it)
    if (!kept.has(id) && await db.get(doc.type, id)) {
      await db.remove(doc, true);
    }
  }
  const synced = await models.workspace.getById(workspace._id);
  if (!synced) {
    throw new Error(`${location}'s workspace could not be loaded`);
  }
  return synced;
}
