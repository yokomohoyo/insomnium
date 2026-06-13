/* eslint-disable prefer-rest-params -- don't want to change ...arguments usage for these sensitive functions without more testing */
import electron from 'electron';
import fsPath from 'path';
import { v4 as uuidv4 } from 'uuid';

import { mustGetModel } from '../models';
import { CookieJar } from '../models/cookie-jar';
import { Environment } from '../models/environment';
import { GitRepository } from '../models/git-repository';
import type { BaseModel } from '../models/index';
import * as models from '../models/index';
import type { Workspace } from '../models/workspace';
import { generateId } from './misc';
import { dummyStartingWorkspace, importToWorkspaceFromJSON } from './import';
import type { SqliteStore, StoreQuery } from './sqlite-store';

export interface Query {
  _id?: string | SpecificQuery;
  parentId?: string | SpecificQuery | null;
  remoteId?: string | null;
  plugin?: string;
  key?: string;
  environmentId?: string | null;
  protoFileId?: string;
}

type Sort = Record<string, any>;

export interface Operation {
  upsert?: BaseModel[];
  remove?: BaseModel[];
}

export interface SpecificQuery {
  $gt?: number;
  $in?: string[];
  $nin?: string[];
}

export type ModelQuery<T extends BaseModel> = Partial<Record<keyof T, SpecificQuery>>;
export type ChangeType = 'insert' | 'update' | 'remove';
export const database = {
  all: async function<T extends BaseModel>(type: string) {
    if (!store) {
      return _send<T[]>('all', ...arguments);
    }
    return database.find<T>(type);
  },

  batchModifyDocs: async function({ upsert = [], remove = [] }: Operation) {
    if (!store) {
      return _send<void>('batchModifyDocs', ...arguments);
    }
    const flushId = await database.bufferChanges();

    // Resolve async work up front (store.transaction is sync), then write the
    // batch atomically - a failure rolls it all back instead of half-applying.
    const s = store;
    const toUpsert = await Promise.all(upsert.map(async doc => ({
      doc: await models.initModel(doc.type, doc),
      existed: !!(await database.get(doc.type, doc._id)),
    })));

    const emitted: ChangeBufferEvent[] = [];
    s.transaction(() => {
      for (const { doc, existed } of toUpsert) {
        const stored = s.upsert(doc) as BaseModel;
        emitted.push([existed ? 'update' : 'insert', stored, true]);
      }
      s.removeByIds(remove.map(d => d._id));
      for (const d of remove) {
        emitted.push(['remove', d, true]);
      }
    });

    for (const [event, doc, fromSync] of emitted) {
      await notifyOfChange(event, doc, fromSync);
    }
    await database.flushChanges(flushId);
  },

  /** buffers database changes and returns a buffer id */
  bufferChanges: async function(millis = 1000) {
    if (!store) {
      return _send<number>('bufferChanges', ...arguments);
    }
    const id = ++bufferChangesId;
    openBuffers.add(id);
    setTimeout(() => database.flushChanges(id), millis);
    return id;
  },

  /** buffers database changes and returns a buffer id */
  bufferChangesIndefinitely: async function() {
    if (!store) {
      return _send<number>('bufferChangesIndefinitely', ...arguments);
    }
    const id = ++bufferChangesId;
    openBuffers.add(id);
    return id;
  },

  count: async function<T extends BaseModel>(type: string, query: Query = {}) {
    if (!store) {
      return _send<number>('count', ...arguments);
    }
    return store.count(type, query as StoreQuery);
  },

  docCreate: async <T extends BaseModel>(type: string, ...patches: Patch<T>[]) => {
    const doc = await models.initModel<T>(
      type,
      ...patches,
      // Fields that the user can't touch
      {
        type: type,
      },
    );
    return database.insert<T>(doc);
  },

  docUpdate: async <T extends BaseModel>(originalDoc: T, ...patches: Patch<T>[]) => {
    // No need to re-initialize the model during update; originalDoc will be in a valid state by virtue of loading
    const doc = await models.initModel<T>(
      originalDoc.type,
      originalDoc,

      // NOTE: This is before `patches` because we want `patch.modified` to win if it has it
      {
        modified: Date.now(),
      },
      ...patches,
    );
    return database.update<T>(doc);
  },

  duplicate: async function<T extends BaseModel>(originalDoc: T, patch: Patch<T> = {}) {
    if (!store) {
      return _send<T>('duplicate', ...arguments);
    }
    const flushId = await database.bufferChanges();

    async function next<T extends BaseModel>(docToCopy: T, patch: Patch<T>) {
      const model = mustGetModel(docToCopy.type);
      const overrides = {
        _id: generateId(model.prefix),
        modified: Date.now(),
        created: Date.now(),
        type: docToCopy.type, // Ensure this is not overwritten by the patch
      };

      // 1. Copy the doc
      const newDoc = Object.assign({}, docToCopy, patch, overrides);

      // Don't initialize the model during insert, and simply duplicate
      const createdDoc = await database.insert(newDoc, false, false);

      // 2. Get all the children
      for (const type of allTypes()) {
        // Note: We never want to duplicate a response
        if (!models.canDuplicate(type)) {
          continue;
        }

        const parentId = docToCopy._id;
        const children = await database.find(type, { parentId });

        for (const doc of children) {
          await next(doc, { parentId: createdDoc._id });
        }
      }

      return createdDoc;
    }

    const createdDoc = await next(originalDoc, patch);
    await database.flushChanges(flushId);
    return createdDoc;
  },

  find: async function<T extends BaseModel>(
    type: string,
    query: Query | string = {},
    sort: Sort = { created: 1 },
  ) {
    if (!store) {
      return _send<T[]>('find', ...arguments);
    }
    const normalizedQuery = typeof query === 'object' && query !== null ? query : {};
    const rawDocs = store.find(type, normalizedQuery as StoreQuery, sort);
    const docs: T[] = [];

    for (const rawDoc of rawDocs) {
      docs.push(await models.initModel(type, rawDoc));
    }

    return docs;
  },

  /** Transitive descendants of rootId, optionally filtered to types. Walks the tree in SQL. */
  findDescendants: async function<T extends BaseModel>(rootId: string, types: string[] = []) {
    if (!store) {
      return _send<T[]>('findDescendants', ...arguments);
    }
    const rawDocs = store.findDescendants(rootId, { types });
    const docs: T[] = [];

    for (const rawDoc of rawDocs) {
      docs.push(await models.initModel(rawDoc.type, rawDoc));
    }

    return docs;
  },

  findMostRecentlyModified: async function<T extends BaseModel>(
    type: string,
    query: Query = {},
    limit: number | null = null,
  ) {
    if (!store) {
      return _send<T[]>('findMostRecentlyModified', ...arguments);
    }
    try {
      const rawDocs = store.find(type, query as StoreQuery, { modified: -1 }, limit);
      const docs: T[] = [];

      for (const rawDoc of rawDocs) {
        docs.push(await models.initModel(type, rawDoc));
      }

      return docs;
    } catch (err) {
      console.warn('[db] Failed to find docs', err);
      return [];
    }
  },

  flushChanges: async function(id = 0, fake = false) {
    if (!store) {
      return _send<void>('flushChanges', ...arguments);
    }

    if (id !== 0) {
      openBuffers.delete(id);
      // Wait until every outstanding buffer has closed so overlapping buffered
      // ops coalesce into one emission instead of stranding each other.
      if (openBuffers.size > 0) {
        return;
      }
    } else {
      // A forced flush (no id) ends the whole buffering session.
      openBuffers.clear();
    }

    const changes = [...changeBuffer];
    changeBuffer = [];

    if (changes.length === 0) {
      // No work to do
      return;
    }

    if (fake) {
      console.log(`[db] Dropped ${changes.length} changes.`);
      return;
    }
    // Notify local listeners too
    for (const fn of changeListeners) {
      await fn(changes);
    }
    // Notify remote listeners
    const isMainContext = process.type === 'browser';
    if (isMainContext) {
      const windows = electron.BrowserWindow.getAllWindows();

      for (const window of windows) {
        window.webContents.send('db.changes', changes);
      }
    }
  },

  get: async function<T extends BaseModel>(type: string, id?: string) {
    if (!store) {
      return _send<T>('get', ...arguments);
    }

    // Short circuit IDs used to represent nothing
    if (!id || id === 'n/a') {
      return null;
    } else {
      return database.getWhere<T>(type, { _id: id });
    }
  },

  getMostRecentlyModified: async function<T extends BaseModel>(type: string, query: Query = {}) {
    if (!store) {
      return _send<T>('getMostRecentlyModified', ...arguments);
    }
    const docs = await database.findMostRecentlyModified<T>(type, query, 1);
    return docs.length ? docs[0] : null;
  },

  getWhere: async function<T extends BaseModel>(type: string, query: ModelQuery<T> | Query) {
    if (!store) {
      return _send<T>('getWhere', ...arguments);
    }
    const docs = await database.find<T>(type, query);
    return docs.length ? docs[0] : null;
  },

  init: async (
    types: string[],
    config: { inMemoryOnly?: boolean } = {},
    forceReset = false,
    consoleLog: typeof console.log = console.log,
  ) => {
    if (forceReset) {
      changeListeners = [];
      changeHooksRegistered = false;
      store?.close();
      store = null;
      initializedTypes.clear();
    }

    if (store) {
      consoleLog('[db] Already initialized DB');
    } else {
      // Lazy-load so renderer bundles never evaluate node:sqlite.
      const { SqliteStore } = await import('./sqlite-store');
      store = new SqliteStore(config.inMemoryOnly ? ':memory:' : getSqliteDBFilePath());
    }

    for (const modelType of types) {
      initializedTypes.add(modelType);
    }

    // One-time legacy NeDB import; old files stay in place as a rollback path.
    if (!config.inMemoryOnly && store.isEmpty()) {
      const target = store;
      let imported = 0;
      target.transaction(() => {
        for (const modelType of types) {
          imported += target.importLegacyNeDBFile(modelType, getDBFilePath(modelType));
        }
      });
      if (imported > 0) {
        consoleLog(`[db] Imported ${imported} docs from legacy NeDB files`);
      }
    }

    // Repeat init() calls (forceReset, tests) must not stack a second handler.
    if (!ipcHandlerRegistered) {
      ipcHandlerRegistered = true;
      electron.ipcMain.on('db.fn', async (e, fnName, replyChannel, ...args) => {
        try {
          // @ts-expect-error -- mapping unsoundness
          const result = await database[fnName](...args);
          e.sender.send(replyChannel, null, result);
        } catch (err) {
          e.sender.send(replyChannel, {
            message: err.message,
            stack: err.stack,
          });
        }
      });
    }

    // NOTE: Only repair the DB if we're not running in memory. Repairing here causes tests to hang indefinitely for some reason.
    // TODO: Figure out why this makes tests hang
    if (!config.inMemoryOnly) {
      await _fixDBShape();
      consoleLog(`[db] Initialized DB at ${getSqliteDBFilePath()}`);
    }

    // This isn't the best place for this but w/e
    // Listen for response deletions and delete corresponding response body files
    if (!changeHooksRegistered) {
      changeHooksRegistered = true;
      database.onChange(async (changes: ChangeBufferEvent[]) => {
        for (const [type, doc] of changes) {
          // TODO(TSCONVERSION) what's returned here is the entire model implementation, not just a model
          // The type definition will be a little confusing
          const m: Record<string, any> | null = models.getModel(doc.type);

          if (!m) {
            continue;
          }

          if (type === 'remove' && typeof m.hookRemove === 'function') {
            try {
              await m.hookRemove(doc, consoleLog);
            } catch (err) {
              consoleLog(`[db] Delete hook failed for ${type} ${doc._id}: ${err.message}`);
            }
          }

          if (type === 'insert' && typeof m.hookInsert === 'function') {
            try {
              await m.hookInsert(doc, consoleLog);
            } catch (err) {
              consoleLog(`[db] Insert hook failed for ${type} ${doc._id}: ${err.message}`);
            }
          }

          if (type === 'update' && typeof m.hookUpdate === 'function') {
            try {
              await m.hookUpdate(doc, consoleLog);
            } catch (err) {
              consoleLog(`[db] Update hook failed for ${type} ${doc._id}: ${err.message}`);
            }
          }
        }
      });
    }

    for (const model of models.all()) {
      // @ts-expect-error -- TSCONVERSION optional type on response
      if (typeof model.hookDatabaseInit === 'function') {
        // @ts-expect-error -- TSCONVERSION optional type on response
        await model.hookDatabaseInit?.(consoleLog);
      }
    }
  },

  initClient: async () => {
    electron.ipcRenderer.on('db.changes', async (_e, changes) => {
      for (const fn of changeListeners) {
        await fn(changes);
      }
    });
    console.log('[db] Initialized DB client');
  },

  insert: async function<T extends BaseModel>(doc: T, fromSync = false, initializeModel = true) {
    if (!store) {
      return _send<T>('insert', ...arguments);
    }
    const docWithDefaults = initializeModel ? await models.initModel<T>(doc.type, doc) : doc;
    const stored = store.insert(docWithDefaults) as T;
    notifyOfChange('insert', stored, fromSync);
    return stored;
  },

  onChange: (callback: ChangeListener) => {
    changeListeners.push(callback);
  },

  offChange: (callback: ChangeListener) => {
    changeListeners = changeListeners.filter(l => l !== callback);
  },

  remove: async function<T extends BaseModel>(doc: T, fromSync = false) {
    if (!store) {
      return _send<void>('remove', ...arguments);
    }

    const flushId = await database.bufferChanges();

    const s = store;
    const docs = await database.withDescendants(doc);
    // One transaction so a chunked multi-DELETE tree can't be left half-deleted.
    s.transaction(() => s.removeByIds(docs.map(d => d._id)));

    docs.map(d => notifyOfChange('remove', d, fromSync));
    await database.flushChanges(flushId);
  },

  removeWhere: async function<T extends BaseModel>(type: string, query: Query) {
    if (!store) {
      return _send<void>('removeWhere', ...arguments);
    }
    const flushId = await database.bufferChanges();

    const s = store;
    const toRemove: BaseModel[] = [];
    for (const doc of await database.find<T>(type, query)) {
      toRemove.push(...await database.withDescendants(doc));
    }
    // All matched trees in one transaction so removeWhere is atomic.
    s.transaction(() => s.removeByIds(toRemove.map(d => d._id)));
    toRemove.map(d => notifyOfChange('remove', d, false));

    await database.flushChanges(flushId);
  },

  /** Removes entries without removing their children */
  unsafeRemove: async function<T extends BaseModel>(doc: T, fromSync = false) {
    if (!store) {
      return _send<void>('unsafeRemove', ...arguments);
    }

    store.removeByIds([doc._id]);
    notifyOfChange('remove', doc, fromSync);
  },

  update: async function<T extends BaseModel>(doc: T, fromSync = false) {
    if (!store) {
      return _send<T>('update', ...arguments);
    }

    const docWithDefaults = await models.initModel<T>(doc.type, doc);
    const stored = store.update(docWithDefaults) as T | null;
    if (!stored) {
      // Don't emit an update event for a doc that no longer exists.
      console.warn(`[db] Skipped update of missing ${doc.type} ${doc._id}`);
      return docWithDefaults;
    }
    notifyOfChange('update', stored, fromSync);
    return stored;
  },

  upsert: async function<T extends BaseModel>(doc: T, fromSync = false) {
    if (!store) {
      return _send<T>('upsert', ...arguments);
    }
    // Atomic INSERT OR REPLACE for the write; we only read existence to pick the
    // event type. A plain get-then-insert races: two concurrent upserts of a new
    // _id both insert and the second throws a PK violation.
    const existed = !!(await database.get<T>(doc.type, doc._id));
    const docWithDefaults = await models.initModel<T>(doc.type, doc);
    const stored = store.upsert(docWithDefaults) as T;
    notifyOfChange(existed ? 'update' : 'insert', stored, fromSync);
    return stored;
  },

  withAncestors: async function<T extends BaseModel>(doc: T | null, types: string[] = allTypes()) {
    if (!store) {
      return _send<T[]>('withAncestors', ...arguments);
    }

    if (!doc) {
      return [];
    }

    let docsToReturn: T[] = doc ? [doc] : [];
    // Guard against parentId cycles (e.g. a request reparented onto itself or a
    // descendant via update_request) - without this the walk recurses forever.
    const seen = new Set<string>([doc._id]);

    async function next(docs: T[]): Promise<T[]> {
      const foundDocs: T[] = [];

      for (const d of docs) {
        for (const type of types) {
          // If the doc is null, we want to search for parentId === null
          const another = await database.get<T>(type, d.parentId);
          if (another && !seen.has(another._id)) {
            seen.add(another._id);
            foundDocs.push(another);
          }
        }
      }

      if (foundDocs.length === 0) {
        // Didn't find anything. We're done
        return docsToReturn;
      }

      // Continue searching for children
      docsToReturn = [
        ...docsToReturn,
        ...foundDocs,
      ];
      return next(foundDocs);
    }

    return next([doc]);
  },

  withDescendants: async function<T extends BaseModel>(doc: T | null, stopType: string | null = null): Promise<BaseModel[]> {
    if (!store) {
      return _send<BaseModel[]>('withDescendants', ...arguments);
    }

    // Null root = "docs with parentId null"; rare, so it keeps the JS walk.
    if (!doc) {
      return _descendantsOfNullParent(stopType);
    }

    const rawDocs = store.findDescendants(doc._id, { stopType, rootType: doc.type });
    const docs: BaseModel[] = [doc];

    for (const rawDoc of rawDocs) {
      docs.push(await models.initModel(rawDoc.type, rawDoc));
    }

    return docs;
  },
};

// Null until init(); the renderer never initializes and proxies over IPC.
let store: SqliteStore | null = null;
const initializedTypes = new Set<string>();
let ipcHandlerRegistered = false;
let changeHooksRegistered = false;

// ~~~~~~~ //
// HELPERS //
// ~~~~~~~ //
const allTypes = () => Array.from(initializedTypes);

// Legacy BFS for withDescendants(null): roots are docs with parentId null.
async function _descendantsOfNullParent(stopType: string | null): Promise<BaseModel[]> {
  let docsToReturn: BaseModel[] = [];

  async function next(parents: (BaseModel | null)[]): Promise<BaseModel[]> {
    let foundDocs: BaseModel[] = [];

    for (const parent of parents) {
      if (stopType && parent && parent.type === stopType) {
        continue;
      }
      for (const type of allTypes()) {
        foundDocs = [...foundDocs, ...await database.find(type, { parentId: parent ? parent._id : null })];
      }
    }

    if (foundDocs.length === 0) {
      return docsToReturn;
    }

    docsToReturn = [...docsToReturn, ...foundDocs];
    return next(foundDocs);
  }

  return next([null]);
}

function getDataDir() {
  return process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData');
}

function getSqliteDBFilePath() {
  return fsPath.join(getDataDir(), 'insomnia.sqlite');
}

// Legacy NeDB file path, now read only by the SQLite migration.
function getDBFilePath(modelType: string) {
  // NOTE: Do not EVER change this. EVER!
  return fsPath.join(getDataDir(), `insomnia.${modelType}.db`);
}

// ~~~~~~~~~~~~~~~~ //
// Change Listeners //
// ~~~~~~~~~~~~~~~~ //
let bufferChangesId = 0;
// Outstanding buffer ids; the change buffer drains only when this empties, so
// overlapping buffered ops coalesce instead of stranding each other's events.
const openBuffers = new Set<number>();

export type ChangeBufferEvent<T extends BaseModel = BaseModel> = [
  event: ChangeType,
  doc: T,
  fromSync: boolean
];

let changeBuffer: ChangeBufferEvent[] = [];

type ChangeListener = (changes: ChangeBufferEvent[]) => void;

let changeListeners: ChangeListener[] = [];

async function notifyOfChange<T extends BaseModel>(event: ChangeType, doc: T, fromSync: boolean) {
  const updatedDoc = doc;

  changeBuffer.push([event, updatedDoc, fromSync]);

  // Flush right away if nothing is buffering
  if (openBuffers.size === 0) {
    await database.flushChanges();
  }
}

// ~~~~~~~~~~~~~~~~~~~ //
// DEFAULT MODEL STUFF //
// ~~~~~~~~~~~~~~~~~~~ //

type Patch<T> = Partial<T>;

// ~~~~~~~ //
// Helpers //
// ~~~~~~~ //
async function _send<T>(fnName: string, ...args: any[]) {
  return new Promise<T>((resolve, reject) => {
    const replyChannel = `db.fn.reply:${uuidv4()}`;
    electron.ipcRenderer.send('db.fn', fnName, replyChannel, ...args);
    electron.ipcRenderer.once(replyChannel, (_e, err, result: T) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Run various database repair scripts
 */
export async function _fixDBShape() {
  console.log('[fix] Running database repairs');
  const workspaces = await database.find<Workspace>(models.workspace.type);
  for (const workspace of workspaces) {
    await _repairBaseEnvironments(workspace);
    await _fixMultipleCookieJars(workspace);
    await _applyApiSpecName(workspace);
  }

  console.log(['workspaces'], workspaces);

  for (const gitRepository of await database.find<GitRepository>(models.gitRepository.type)) {
    await _fixOldGitURIs(gitRepository);
  }
}

/**
 * This function ensures that apiSpec exists for each workspace
 * If the filename on the apiSpec is not set or is the default initialized name
 * It will apply the workspace name to it
 */
async function _applyApiSpecName(workspace: Workspace) {
  const apiSpec = await models.apiSpec.getByParentId(workspace._id);
  if (apiSpec === null) {
    return;
  }

  if (!apiSpec.fileName || apiSpec.fileName === models.apiSpec.init().fileName) {
    await models.apiSpec.update(apiSpec, {
      fileName: workspace.name,
    });
  }
}

/**
 * This function repairs workspaces that have multiple base environments. Since a workspace
 * can only have one, this function walks over all base environments, merges the data, and
 * moves all children as well.
 */
async function _repairBaseEnvironments(workspace: Workspace) {
  const baseEnvironments = await database.find<Environment>(models.environment.type, {
    parentId: workspace._id,
  });

  // Nothing to do here
  if (baseEnvironments.length <= 1) {
    return;
  }

  const chosenBase = baseEnvironments[0];

  for (const baseEnvironment of baseEnvironments) {
    if (baseEnvironment._id === chosenBase._id) {
      continue;
    }

    chosenBase.data = Object.assign(baseEnvironment.data, chosenBase.data);
    const subEnvironments = await database.find<Environment>(models.environment.type, {
      parentId: baseEnvironment._id,
    });

    for (const subEnvironment of subEnvironments) {
      await database.docUpdate(subEnvironment, {
        parentId: chosenBase._id,
      });
    }

    // Remove unnecessary base env
    await database.remove(baseEnvironment);
  }

  // Update remaining base env
  await database.update(chosenBase);
  console.log(`[fix] Merged ${baseEnvironments.length} base environments under ${workspace.name}`);
}

/**
 * This function repairs workspaces that have multiple cookie jars. Since a workspace
 * can only have one, this function walks over all jars and merges them and their cookies
 * together.
 */
async function _fixMultipleCookieJars(workspace: Workspace) {
  const cookieJars = await database.find<CookieJar>(models.cookieJar.type, {
    parentId: workspace._id,
  });

  // Nothing to do here
  if (cookieJars.length <= 1) {
    return;
  }

  const chosenJar = cookieJars[0];

  for (const cookieJar of cookieJars) {
    if (cookieJar._id === chosenJar._id) {
      continue;
    }

    for (const cookie of cookieJar.cookies) {
      if (chosenJar.cookies.find(c => c.id === cookie.id)) {
        continue;
      }

      chosenJar.cookies.push(cookie);
    }

    // Remove unnecessary jar
    await database.remove(cookieJar);
  }

  // Update remaining jar
  await database.update(chosenJar);
  console.log(`[fix] Merged ${cookieJars.length} cookie jars under ${workspace.name}`);
}

// Append .git to old git URIs to mimic previous isomorphic-git behaviour
async function _fixOldGitURIs(doc: GitRepository) {
  if (!doc.uriNeedsMigration) {
    return;
  }

  if (!doc.uri.endsWith('.git')) {
    doc.uri += '.git';
  }

  doc.uriNeedsMigration = false;
  await database.update(doc);
  console.log(`[fix] Fixed git URI for ${doc._id}`);
}
