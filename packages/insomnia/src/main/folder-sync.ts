// Keeps a collection and a folder of readable files in step
// (sync/folder/layout.ts says which files): the app writes the files when the
// collection changes, and takes in what changes in the folder (an editor's
// edit, a new file, a deleted one, a git checkout), as the latest. Whatever
// was changed in the folder while the app was closed comes in when it opens.
// Only files that read as the collection's are taken: other YAML in the folder
// (a repository's own) is left alone, never overwritten, and its names are
// kept clear of; so are dot folders such as .git, and links.
//
// What it takes in is only what changed: a file whose text differs from what
// the sync last wrote or read there. A document goes when its file is
// deleted, never because a file couldn't be read: that file is left as it is
// until it reads again (a half-saved edit, a merge conflict).
import fs from 'fs';
import path from 'path';

import { ipcMain } from 'electron';

import { type ChangeBufferEvent, database as db } from '../common/database';
import { generateId } from '../common/misc';
import * as models from '../models';
import type { BaseModel } from '../models';
import type { WorkspaceMeta } from '../models/workspace-meta';
import { COLLECTION_FILE, collectionFiles, comparable, FOLDER_FILE, folderDocs, type FolderDocs, REQUEST_TYPES, type SyncDoc } from '../sync/folder/layout';
import { folderSchema, SCHEMA_DIR, SCHEMA_FILE } from '../sync/folder/schema';

const SCHEMA_TEXT = JSON.stringify(folderSchema, null, 2) + '\n';

const SYNCED_TYPES = new Set(['Workspace', 'Environment', 'RequestGroup', ...REQUEST_TYPES, 'ResponseExample']);
// what the sync holds for a file of its own it couldn't read: never the file's text
const UNREAD = '\u0000';
const SETTLE_MS = 300;

const newId = (type: string) => generateId(models.getModel(type)?.prefix || 'doc');

interface FolderContents {
  files: Map<string, string>;
  // what isn't a plain file or folder (links, devices), lowercase: the
  // collection's files are named around them, and never written through them
  blocked: Set<string>;
}

async function readFolder(root: string): Promise<FolderContents> {
  const files = new Map<string, string>();
  const blocked = new Set<string>();
  const walk = async (dir: string, relative: string) => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.yaml')) {
          files.set(rel, await fs.promises.readFile(path.join(dir, entry.name), 'utf8'));
        }
      } else {
        blocked.add(rel.toLowerCase());
      }
    }
  };
  await walk(root, '');
  return { files, blocked };
}

const isWithin = (root: string, target: string) => target === root || target.startsWith(root + path.sep);

export class FolderSync {
  // the files as they were when the two were last in step (written, or taken
  // in, by the sync), and the documents each held
  written = new Map<string, string>();
  held = new Map<string, string[]>();
  ids = new Set<string>();
  // what couldn't be read or written, the last time it tried
  problems: string[] = [];
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
    const { files } = await readFolder(this.root);
    if (files.has(COLLECTION_FILE)) {
      const parsed = folderDocs(files, newId);
      const workspace = parsed.docs.find(doc => doc.type === 'Workspace');
      if (workspace && workspace._id !== this.workspaceId) {
        throw new Error(`This folder has another collection, "${workspace.name}". Choose an empty folder, or this collection's own.`);
      }
      const meta = await models.workspaceMeta.getOrCreateByParentId(this.workspaceId);
      // all of it is new to this run: what changed while the app was closed comes in
      const taken = await this.takeIn(files, new Set(files.keys()), new Set(), parsed);
      // and what was deleted then, of what the folder held before; unless a
      // file couldn't be read, when what it held isn't known
      if (taken && !parsed.failed.size) {
        await this.removeMissing(new Set(meta.folderSyncIds || []), parsed);
      }
      // the collection's files it couldn't read (and those in a folder whose
      // own file it couldn't): the sync's, left alone until they read
      const folders = [...files.keys()].filter(rel => rel.endsWith(`/${FOLDER_FILE}`)).map(rel => rel.slice(0, rel.lastIndexOf('/')));
      for (const rel of files.keys()) {
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        if (!this.written.has(rel) && (parsed.failed.has(rel) || folders.some(folder => dir === folder || dir.startsWith(`${folder}/`)))) {
          this.written.set(rel, UNREAD);
        }
      }
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
    const { files } = await readFolder(this.root);
    const changed = new Set([...files.keys()].filter(rel => files.get(rel) !== this.written.get(rel)));
    const deleted = new Set([...this.written.keys()].filter(rel => !files.has(rel)));
    if (changed.size || deleted.size) {
      await this.takeIn(files, changed, deleted);
    }
    await this.writeOut();
  }

  private problem(text: string) {
    this.problems.push(text);
    console.warn('[folder-sync]', text);
  }

  // is the id already some other collection's, or another kind of document's?
  private async takenElsewhere(id: string) {
    for (const type of SYNCED_TYPES) {
      if (await db.get(type, id)) {
        return true;
      }
    }
    return false;
  }

  // The changed files into the collection, and the documents of the deleted
  // ones out of it. Returns whether the folder is this collection's.
  async takeIn(files: Map<string, string>, changed: Set<string>, deleted: Set<string>, parsed: FolderDocs = folderDocs(files, newId)) {
    this.problems = [];
    parsed.problems.forEach(problem => this.problem(problem));
    const workspace = parsed.docs.find(doc => doc.type === 'Workspace');
    if (!workspace) {
      return false;
    }
    if (workspace._id !== this.workspaceId) {
      this.problem(`${COLLECTION_FILE} is another collection's now, so nothing in the folder is taken in`);
      return false;
    }
    const current = new Map((await this.docs()).map(doc => [doc._id, doc]));

    // A file that's a copy of another (the same _id), or holds another
    // collection's or another kind's _id, is a new document; the one of
    // several that the sync wrote (or else the first) keeps the _id.
    const key = (id: string, rel: string) => `${rel}\u0000${id}`;
    const original = new Map<string, number>();
    parsed.docs.forEach((doc, index) => {
      const previous = original.get(doc._id);
      const heldHere = (index: number) => (this.held.get(parsed.paths[index]) || []).includes(doc._id);
      if (previous === undefined || (heldHere(index) && !heldHere(previous))) {
        original.set(doc._id, index);
      }
    });
    const anew = new Map<string, string>();
    for (const [index, doc] of parsed.docs.entries()) {
      if (doc.type === 'Workspace') {
        continue;
      }
      const prefix = models.getModel(doc.type)?.prefix;
      const existing = current.get(doc._id);
      if (original.get(doc._id) !== index
        || (prefix && !doc._id.startsWith(`${prefix}_`))
        || (existing && existing.type !== doc.type)
        || (!existing && changed.has(parsed.paths[index]) && await this.takenElsewhere(doc._id))) {
        anew.set(key(doc._id, parsed.paths[index]), newId(doc.type));
      }
    }
    const resolved = anew.size ? folderDocs(files, newId, (id, _type, rel) => anew.get(key(id, rel))) : parsed;

    const taken = new Map<string, string[]>();
    for (const [index, doc] of resolved.docs.entries()) {
      const rel = resolved.paths[index];
      if (!changed.has(rel)) {
        continue;
      }
      if (doc.type === 'Workspace') {
        const existing = current.get(this.workspaceId);
        if (existing && (existing.name !== doc.name || existing.description !== doc.description)) {
          const renamed: SyncDoc = { ...existing, name: doc.name, description: doc.description ?? '' };
          await db.update(renamed as BaseModel, true);
        }
        continue;
      }
      taken.set(rel, [...(taken.get(rel) || []), doc._id]);
      const existing = current.get(doc._id);
      if (!existing) {
        await db.upsert(doc as BaseModel, true);
        continue;
      }
      const merged = { ...existing, ...doc };
      if (comparable(merged) !== comparable(existing) || existing.parentId !== doc.parentId) {
        await db.upsert(merged as BaseModel, true);
      }
    }
    // the files taken in are the sync's now: written over, or renamed, to their documents' own
    for (const [rel, ids] of taken) {
      this.written.set(rel, files.get(rel)!);
      this.held.set(rel, ids);
    }

    // only a deleted file's documents go, and not if they moved to another file
    const inFolder = new Set(resolved.docs.map(doc => doc._id));
    for (const rel of deleted) {
      for (const id of this.held.get(rel) || []) {
        const doc = current.get(id);
        if (doc && !inFolder.has(id) && this.isRemovable(doc)) {
          const stillThere = await db.get(doc.type, doc._id);
          if (stillThere) {
            await db.remove(stillThere, true);
          }
        }
      }
      this.held.delete(rel);
      this.written.delete(rel);
    }
    return true;
  }

  private isRemovable(doc: SyncDoc) {
    const isBaseEnvironment = doc.type === 'Environment' && doc.parentId === this.workspaceId;
    return doc.type !== 'Workspace' && !isBaseEnvironment && !doc.isPrivate;
  }

  // at the start: what the folder held before and doesn't now
  private async removeMissing(known: Set<string>, parsed: FolderDocs) {
    const inFolder = new Set(parsed.docs.map(doc => doc._id));
    for (const doc of await this.docs()) {
      if (known.has(doc._id) && !inFolder.has(doc._id) && this.isRemovable(doc)) {
        const stillThere = await db.get(doc.type, doc._id);
        if (stillThere) {
          await db.remove(stillThere, true);
        }
      }
    }
  }

  // a path in the folder to write or remove, if it stays inside the folder
  private async inside(rel: string) {
    const file = path.join(this.root, ...rel.split('/'));
    const root = await fs.promises.realpath(this.root);
    // the nearest folder that's there already decides where it lands
    let dir = path.dirname(file);
    while (!(await fs.promises.stat(dir).catch(() => null))) {
      dir = path.dirname(dir);
    }
    if (!isWithin(root, await fs.promises.realpath(dir))) {
      throw new Error(`${rel} would be outside the folder`);
    }
    if ((await fs.promises.lstat(file).catch(() => null))?.isSymbolicLink()) {
      throw new Error(`${rel} is a link`);
    }
    return file;
  }

  // the collection out to its files, writing only what changed, and removing
  // the files of what's gone
  async writeOut() {
    const docs = await this.docs();
    const { files: onDisk, blocked } = await readFolder(this.root);
    // what's in the folder and isn't the sync's: never written over
    const reserved = new Set([...blocked, ...[...onDisk.keys()].filter(rel => !this.written.has(rel)).map(rel => rel.toLowerCase())]);
    const files = collectionFiles(docs, reserved);
    // a file of the sync's that changed and wasn't taken in (it doesn't read,
    // or its folder's file doesn't) is an edit in progress: left as it is
    const pending = (rel: string) => this.written.has(rel) && onDisk.has(rel) && onDisk.get(rel) !== this.written.get(rel);

    // the schema the files name, kept up to date (a dot folder, so never read as the collection's)
    const schemaPath = path.join(this.root, SCHEMA_DIR, SCHEMA_FILE);
    if ((await fs.promises.readFile(schemaPath, 'utf8').catch(() => null)) !== SCHEMA_TEXT) {
      await fs.promises.mkdir(path.dirname(schemaPath), { recursive: true });
      await fs.promises.writeFile(schemaPath, SCHEMA_TEXT).catch(err => this.problem(`${SCHEMA_DIR}/${SCHEMA_FILE}: ${err.message}`));
    }

    const written = new Map<string, string>();
    for (const [rel, content] of files) {
      if (pending(rel)) {
        written.set(rel, this.written.get(rel)!);
        continue;
      }
      try {
        if (onDisk.get(rel) !== content) {
          const file = await this.inside(rel);
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, content);
        }
        written.set(rel, content);
      } catch (err) {
        this.problem(`${rel}: ${err instanceof Error ? err.message : err}`);
      }
    }
    for (const rel of this.written.keys()) {
      if (files.has(rel) || !onDisk.has(rel)) {
        continue;
      }
      if (pending(rel)) {
        written.set(rel, this.written.get(rel)!);
        continue;
      }
      try {
        const file = await this.inside(rel);
        await fs.promises.rm(file, { force: true });
        // and the folder it was in, once empty
        for (let dir = path.dirname(file); isWithin(this.root, dir) && dir !== this.root; dir = path.dirname(dir)) {
          if ((await fs.promises.readdir(dir).catch(() => ['?'])).length) {
            break;
          }
          await fs.promises.rmdir(dir).catch(() => undefined);
        }
      } catch (err) {
        this.problem(`${rel}: ${err instanceof Error ? err.message : err}`);
        written.set(rel, this.written.get(rel)!);
      }
    }
    this.written = written;

    // what each file holds, and all the ids the folder has, as written
    const parsed = folderDocs(files, newId);
    this.held = new Map();
    parsed.docs.forEach((doc, index) => this.held.set(parsed.paths[index], [...(this.held.get(parsed.paths[index]) || []), doc._id]));
    const ids = new Set(parsed.docs.map(doc => doc._id));
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
