// Keeps a collection and a folder of readable files in step
// (sync/folder/layout.ts says which files): the app writes the files when the
// collection changes, and takes in what changes in the folder (an editor's
// edit, a new file, a deleted one, a git checkout), as the latest. Whatever
// was changed in the folder while the app was closed comes in when it opens.
// Only files that read as the collection's are taken: other YAML in the folder
// (a repository's own) is left alone, and so are dot folders such as .git.
import fs from 'fs';
import path from 'path';

import { ipcMain } from 'electron';

import { type ChangeBufferEvent, database as db } from '../common/database';
import { generateId } from '../common/misc';
import * as models from '../models';
import type { BaseModel } from '../models';
import type { WorkspaceMeta } from '../models/workspace-meta';
import { COLLECTION_FILE, collectionFiles, comparable, folderDocs, REQUEST_TYPES, type SyncDoc } from '../sync/folder/layout';

const SYNCED_TYPES = new Set(['Workspace', 'Environment', 'RequestGroup', ...REQUEST_TYPES, 'ResponseExample']);
const SETTLE_MS = 300;

const newId = (type: string) => generateId(models.getModel(type)?.prefix || 'doc');

async function readYamlFiles(root: string) {
  const files = new Map<string, string>();
  const walk = async (dir: string, relative: string) => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        files.set(rel, await fs.promises.readFile(path.join(dir, entry.name), 'utf8'));
      }
    }
  };
  await walk(root, '');
  return files;
}

export class FolderSync {
  // what the folder held when the two were last in step, by file
  written = new Map<string, string>();
  ids = new Set<string>();
  private watcher?: fs.FSWatcher;
  private timer?: NodeJS.Timeout;
  private running: Promise<void> = Promise.resolve();

  constructor(readonly workspaceId: string, readonly root: string) {}

  async docs(): Promise<SyncDoc[]> {
    const workspace = await models.workspace.getById(this.workspaceId);
    if (!workspace) {
      return [];
    }
    return (await db.withDescendants(workspace)).filter(doc => SYNCED_TYPES.has(doc.type)) as SyncDoc[];
  }

  async start() {
    await fs.promises.mkdir(this.root, { recursive: true });
    const files = await readYamlFiles(this.root);
    if (files.has(COLLECTION_FILE)) {
      const { docs } = folderDocs(files, newId);
      const workspace = docs.find(doc => doc.type === 'Workspace');
      if (workspace && workspace._id !== this.workspaceId) {
        throw new Error(`This folder has another collection, "${workspace.name}". Choose an empty folder, or this collection's own.`);
      }
      const meta = await models.workspaceMeta.getOrCreateByParentId(this.workspaceId);
      await this.takeIn(files, new Set(meta.folderSyncIds || []));
    }
    await this.writeOut();
    this.watcher = fs.watch(this.root, { recursive: true }, (_event, file) => {
      if (file && String(file).split(/[\\/]/).some(part => part.startsWith('.'))) {
        return;
      }
      this.schedule();
    });
  }

  stop() {
    this.watcher?.close();
    clearTimeout(this.timer);
  }

  // after a change in the folder or the app has settled
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.running = this.running.then(() => this.reconcile()).catch(err => console.error('[folder-sync]', err));
    }, SETTLE_MS);
  }

  isOurs(doc: BaseModel) {
    return SYNCED_TYPES.has(doc.type) && (doc._id === this.workspaceId || this.ids.has(doc._id) || (doc.parentId !== null && (doc.parentId === this.workspaceId || this.ids.has(doc.parentId))));
  }

  async reconcile() {
    const files = await readYamlFiles(this.root);
    const changedOutside = [...files].some(([rel, content]) => this.written.has(rel) ? this.written.get(rel) !== content : content.length > 0)
      || [...this.written.keys()].some(rel => !files.has(rel));
    if (changedOutside) {
      await this.takeIn(files, this.ids);
    }
    await this.writeOut();
  }

  // the folder's files into the collection: new and changed documents, and
  // those whose files were deleted (of the ones it had before)
  async takeIn(files: Map<string, string>, known: Set<string>) {
    const { docs: fromFolder, problems } = folderDocs(files, newId);
    problems.forEach(problem => console.warn('[folder-sync]', problem));
    if (!fromFolder.some(doc => doc.type === 'Workspace')) {
      return;
    }
    const current = new Map((await this.docs()).map(doc => [doc._id, doc]));
    for (const doc of fromFolder) {
      const existing = current.get(doc._id);
      if (doc.type === 'Workspace') {
        if (existing && (existing.name !== doc.name || existing.description !== doc.description)) {
          const renamed: SyncDoc = { ...existing, name: doc.name, description: doc.description ?? '' };
          await db.update(renamed as BaseModel, true);
        }
        continue;
      }
      if (!existing) {
        await db.upsert(doc as BaseModel, true);
        continue;
      }
      const merged = { ...existing, ...doc };
      if (comparable(merged) !== comparable(existing) || existing.parentId !== doc.parentId) {
        await db.upsert(merged as BaseModel, true);
      }
    }
    const inFolder = new Set(fromFolder.map(doc => doc._id));
    for (const doc of current.values()) {
      const isBaseEnvironment = doc.type === 'Environment' && doc.parentId === this.workspaceId;
      if (known.has(doc._id) && !inFolder.has(doc._id) && doc.type !== 'Workspace' && !isBaseEnvironment && !doc.isPrivate) {
        const stillThere = await db.get(doc.type, doc._id);
        if (stillThere) {
          await db.remove(stillThere, true);
        }
      }
    }
  }

  // the collection out to its files, writing only what changed, and removing
  // the files of what's gone
  async writeOut() {
    const docs = await this.docs();
    const files = collectionFiles(docs);
    for (const [rel, content] of files) {
      const file = path.join(this.root, ...rel.split('/'));
      const onDisk = await fs.promises.readFile(file, 'utf8').catch(() => null);
      if (onDisk !== content) {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, content);
      }
    }
    for (const rel of this.written.keys()) {
      if (!files.has(rel)) {
        const file = path.join(this.root, ...rel.split('/'));
        await fs.promises.rm(file, { force: true });
        // and the folder it was in, once empty
        for (let dir = path.dirname(file); dir.startsWith(this.root) && dir !== this.root; dir = path.dirname(dir)) {
          if ((await fs.promises.readdir(dir).catch(() => ['?'])).length) {
            break;
          }
          await fs.promises.rmdir(dir).catch(() => undefined);
        }
      }
    }
    this.written = files;
    const ids = new Set(docs.filter(doc => !doc.isPrivate).map(doc => doc._id));
    if ([...ids].sort().join() !== [...this.ids].sort().join()) {
      this.ids = ids;
      const meta = await models.workspaceMeta.getOrCreateByParentId(this.workspaceId);
      await models.workspaceMeta.update(meta, { folderSyncIds: [...ids] });
    }
  }
}

const syncs = new Map<string, FolderSync>();
let listening = false;

const listen = () => {
  if (listening) {
    return;
  }
  listening = true;
  db.onChange((changes: ChangeBufferEvent[]) => {
    for (const sync of syncs.values()) {
      if (changes.some(([, doc]) => sync.isOurs(doc))) {
        sync.schedule();
      }
    }
  });
};

export async function startFolderSync({ workspaceId, folder }: { workspaceId: string; folder: string }) {
  await stopFolderSync({ workspaceId, forget: false });
  const sync = new FolderSync(workspaceId, path.resolve(folder));
  await sync.start();
  syncs.set(workspaceId, sync);
  listen();
  const meta = await models.workspaceMeta.getOrCreateByParentId(workspaceId);
  if (meta.syncFolderPath !== sync.root) {
    await models.workspaceMeta.update(meta, { syncFolderPath: sync.root });
  }
  return sync.root;
}

export async function stopFolderSync({ workspaceId, forget = true }: { workspaceId: string; forget?: boolean }) {
  syncs.get(workspaceId)?.stop();
  syncs.delete(workspaceId);
  if (forget) {
    const meta = await models.workspaceMeta.getOrCreateByParentId(workspaceId);
    await models.workspaceMeta.update(meta, { syncFolderPath: '', folderSyncIds: [] });
  }
}

export const folderSyncStatus = ({ workspaceId }: { workspaceId: string }) => syncs.get(workspaceId)?.root || null;

// the folders collections were synced to when the app last closed
export async function restoreFolderSyncs() {
  const metas = await db.find<WorkspaceMeta>(models.workspaceMeta.type);
  for (const meta of metas.filter(meta => meta.syncFolderPath && meta.parentId)) {
    await startFolderSync({ workspaceId: meta.parentId as string, folder: meta.syncFolderPath })
      .catch(err => console.error(`[folder-sync] Couldn't sync ${meta.parentId} to ${meta.syncFolderPath}:`, err));
  }
}

export interface FolderSyncBridgeAPI {
  start: (options: { workspaceId: string; folder: string }) => Promise<string>;
  stop: (options: { workspaceId: string }) => Promise<void>;
  status: (options: { workspaceId: string }) => Promise<string | null>;
}

export function registerFolderSyncHandlers() {
  ipcMain.handle('folderSync.start', (_, options: { workspaceId: string; folder: string }) => startFolderSync(options));
  ipcMain.handle('folderSync.stop', (_, options: { workspaceId: string }) => stopFolderSync(options));
  ipcMain.handle('folderSync.status', (_, options: { workspaceId: string }) => folderSyncStatus(options));
}
