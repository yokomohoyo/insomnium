import { PromiseFsClient } from 'isomorphic-git';
import path from 'path';
import YAML from 'yaml';

import { database as db } from '../../common/database';
import * as models from '../../models';
import { BaseModel } from '../../models';
import { isWorkspace, Workspace, WorkspaceScopeKeys } from '../../models/workspace';
import { resetKeys } from '../ignore-keys';
import { GIT_INSOMNIA_DIR, GIT_INSOMNIA_DIR_NAME } from './git-vcs';
import parseGitPath from './parse-git-path';
import Stat from './stat';
import { SystemError } from './system-error';

// A repository only ever gets to write the types Git Sync writes out (canSync),
// whatever else it contains.
export const isGitSyncedType = (type: string | null) => !!type && models.getModel(type)?.canSync === true;

// Every type shares one _id keyspace (rows are replaced by _id), so a synced doc
// whose _id carries another model's prefix could replace, say, a Settings row.
// Unprefixed legacy ids are fine.
const carriesOtherPrefix = (doc: BaseModel) =>
  typeof doc._id !== 'string' || models.all().some(model => model.type !== doc.type && doc._id.startsWith(`${model.prefix}_`));

// The documents a cloned repository may add, held to the same rules as
// NeDBClient.writeFile: a synced type, in its type's folder, named by its _id,
// which does not carry another type's prefix.
export async function readClonedDocs(fsClient: PromiseFsClient) {
  const docs: BaseModel[] = [];
  for (const type of await fsClient.promises.readdir(GIT_INSOMNIA_DIR)) {
    if (!isGitSyncedType(type)) {
      console.log(`[git] Ignoring ${type} in the cloned repository`);
      continue;
    }
    const typeDir = path.join(GIT_INSOMNIA_DIR, type);
    for (const fileName of await fsClient.promises.readdir(typeDir)) {
      const doc: BaseModel | null = YAML.parse((await fsClient.promises.readFile(path.join(typeDir, fileName))).toString());
      if (!doc || doc.type !== type || `${doc._id}.yml` !== fileName || carriesOtherPrefix(doc)) {
        console.log(`[git] Ignoring ${type}/${fileName} in the cloned repository`);
        continue;
      }
      docs.push(doc);
    }
  }
  return docs;
}

// Writes a cloned repository into the project: its one Workspace and the other
// synced documents. Nothing is written if that workspace is missing, ambiguous
// or already in the app. The workspace is new, so a doc whose _id is already
// in the app, or whose parents lead outside the repository, is someone else's.
export async function importClonedDocs(fsClient: PromiseFsClient, projectId: string): Promise<
  { error: string } | { existingWorkspace: Workspace } | { workspace: Workspace }
> {
  const docs = await readClonedDocs(fsClient);
  const workspaces = docs.filter(isWorkspace);
  if (workspaces.length !== 1) {
    return { error: workspaces.length ? 'Multiple workspaces found in repository. Expected one.' : 'No workspaces found in repository' };
  }
  const [workspace] = workspaces;
  const existingWorkspace = await models.workspace.getById(workspace._id);
  if (existingWorkspace) {
    return { existingWorkspace };
  }
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
  workspace.parentId = projectId;
  workspace.scope = workspace.scope === WorkspaceScopeKeys.collection ? WorkspaceScopeKeys.collection : WorkspaceScopeKeys.design;
  for (const doc of docs) {
    if (!inRepository(doc) || await db.get(doc.type, doc._id)) {
      console.log(`[git] Ignoring ${doc.type} ${doc._id} in the cloned repository: it belongs elsewhere`);
      continue;
    }
    await db.upsert(doc);
  }
  return { workspace };
}

export class NeDBClient {
  _workspaceId: string;
  _projectId: string;

  constructor(workspaceId: string, projectId: string) {
    if (!workspaceId) {
      throw new Error('Cannot use NeDBClient without workspace ID');
    }

    this._workspaceId = workspaceId;
    this._projectId = projectId;
  }

  static createClient(workspaceId: string, projectId: string): PromiseFsClient {
    return {
      promises: new NeDBClient(workspaceId, projectId),
    };
  }

  async readFile(
    filePath: string,
    options?: BufferEncoding | { encoding?: BufferEncoding },
  ) {
    filePath = path.normalize(filePath);
    options = options || {};

    if (typeof options === 'string') {
      options = {
        encoding: options,
      };
    }

    const { root, type, id } = parseGitPath(filePath);

    if (root === null || id === null || type === null) {
      throw this._errMissing(filePath);
    }

    const doc = await db.get(type, id);

    if (!doc || doc.isPrivate) {
      throw this._errMissing(filePath);
    }

    // When git is reading from NeDb, reset keys we wish to ignore to their original values
    resetKeys(doc);

    // It would be nice to be able to add this check here but we can't since
    // isomorphic-git may have just deleted the workspace from the FS. This
    // happens frequently during branch checkouts and merges
    //
    // if (doc.type !== models.workspace.type) {
    //   const ancestors = await db.withAncestors(doc);
    //   if (!ancestors.find(isWorkspace)) {
    //     throw new Error(`Not found under workspace ${filePath}`);
    //   }
    // }
    const raw = Buffer.from(YAML.stringify(doc), 'utf8');

    if (options.encoding) {
      return raw.toString(options.encoding);
    } else {
      return raw;
    }
  }

  async writeFile(filePath: string, data: Buffer | string) {
    filePath = path.normalize(filePath);
    const { root, id, type } = parseGitPath(filePath);

    if (root !== GIT_INSOMNIA_DIR_NAME) {
      console.log(`[git] Ignoring external file ${filePath}`);
      return;
    }

    if (!isGitSyncedType(type)) {
      console.log(`[git] Ignoring ${filePath}: not a synced type`);
      return;
    }

    const doc: BaseModel = YAML.parse(data.toString());

    if (id !== doc._id) {
      throw new Error(`Doc _id does not match file path [${doc._id} != ${id || 'null'}]`);
    }

    if (type !== doc.type) {
      throw new Error(`Doc type does not match file path [${doc.type} != ${type || 'null'}]`);
    }

    if (carriesOtherPrefix(doc)) {
      console.log(`[git] Ignoring ${filePath}: its _id belongs to another type`);
      return;
    }

    if (isWorkspace(doc)) {
      console.log('[git] setting workspace parent to be that of the active project', { original: doc.parentId, new: this._projectId });
      // Whenever we write a workspace into nedb we should set the parentId to be that of the current project
      // This is because the parentId (or a project) is not synced into git, so it will be cleared whenever git writes the workspace into the db, thereby removing it from the project on the client
      // In order to reproduce this bug, comment out the following line, then clone a repository into a local project, then open the workspace, you'll notice it will have moved into the default project
      doc.parentId = this._projectId;
    }

    await db.upsert(doc, true);
  }

  async unlink(filePath: string) {
    filePath = path.normalize(filePath);
    const { id, type } = parseGitPath(filePath);

    if (!id || !type) {
      throw new Error(`Cannot unlink file ${filePath}`);
    }

    // Git Sync never wrote anything else, so it never deletes anything else
    if (!isGitSyncedType(type)) {
      console.log(`[git] Ignoring removal of ${filePath}: not a synced type`);
      return;
    }

    const doc = await db.get(type, id);

    if (!doc) {
      return;
    }

    await db.unsafeRemove(doc, true);
  }

  async readdir(filePath: string) {
    filePath = path.normalize(filePath);
    const { root, type, id } = parseGitPath(filePath);
    let docs: BaseModel[] = [];
    let otherFolders: string[] = [];

    if (root === null && id === null && type === null) {
      otherFolders = [GIT_INSOMNIA_DIR_NAME];
    } else if (id === null && type === null) {
      otherFolders = [
        models.workspace.type,
        models.environment.type,
        models.requestGroup.type,
        models.request.type,
        models.apiSpec.type,
        models.unitTestSuite.type,
        models.unitTest.type,
        models.grpcRequest.type,
        models.protoFile.type,
        models.protoDirectory.type,
        models.webSocketRequest.type,
        models.webSocketPayload.type,
      ];
    } else if (type !== null && id === null) {
      const workspace = await db.get(models.workspace.type, this._workspaceId);
      const children = await db.withDescendants(workspace);
      docs = children.filter(d => d.type === type && !d.isPrivate);
    } else {
      throw this._errMissing(filePath);
    }

    const ids = docs.map(d => `${d._id}.yml`);
    return [...ids, ...otherFolders].sort();
  }

  async mkdir() {
    throw new Error('NeDBClient is not writable');
  }

  async stat(filePath: string) {
    filePath = path.normalize(filePath);
    let fileBuff: Buffer | string | null = null;
    let dir: string[] | null = null;

    try {
      fileBuff = await this.readFile(filePath);
    } catch (err) {
      // console.log('[nedb] Failed to read file', err);
    }

    if (fileBuff === null) {
      try {
        dir = await this.readdir(filePath);
      } catch (err) {
        // console.log('[nedb] Failed to read dir', err);
      }
    }

    if (!fileBuff && !dir) {
      throw this._errMissing(filePath);
    }

    if (fileBuff) {
      const doc: BaseModel = YAML.parse(fileBuff.toString());
      return new Stat({
        type: 'file',
        mode: 0o777,
        size: fileBuff.length,
        // @ts-expect-error should be number instead of string https://nodejs.org/api/fs.html#fs_stats_ino
        ino: doc._id,
        mtimeMs: doc.modified,
      });
    } else {
      return new Stat({
        type: 'dir',
        mode: 0o777,
        size: 0,
        ino: 0,
        mtimeMs: 0,
      });
    }
  }

  async readlink(filePath: string, ...x: any[]) {
    return this.readFile(filePath, ...x);
  }

  async lstat(filePath: string) {
    return this.stat(filePath);
  }

  async rmdir() {
    // Dirs in NeDB can't be removed, so we'll just pretend like it succeeded
    return Promise.resolve();
  }

  async symlink() {
    throw new Error('NeDBClient symlink not supported');
  }

  _errMissing(filePath: string) {
    return new SystemError({
      message: `ENOENT: no such file or directory, scandir '${filePath}'`,
      errno: -2,
      code: 'ENOENT',
      syscall: 'scandir',
      path: filePath,
    });
  }
}
