// SQLite-backed document store replacing the per-type NeDB datastores.
// Docs stay schemaless JSON; key fields are hoisted into indexed columns.

import fs from 'fs';

// Type-only: node:sqlite is loaded lazily, in the main process only.
type DatabaseSync = import('node:sqlite').DatabaseSync;

interface OperatorQuery {
  $gt?: number;
  $in?: any[];
  $nin?: any[];
}

type QueryCondition = string | number | boolean | null | undefined | OperatorQuery;

export type StoreQuery = Record<string, QueryCondition>;

export interface StoreDoc {
  _id: string;
  type: string;
  parentId?: string | null;
  created?: number;
  modified?: number;
  [key: string]: any;
}

const isOperator = (cond: QueryCondition): cond is OperatorQuery =>
  cond !== null && typeof cond === 'object';

function conditionMatches(value: any, cond: QueryCondition): boolean {
  if (isOperator(cond)) {
    if (cond.$gt !== undefined && !(value > cond.$gt)) {
      return false;
    }
    if (cond.$in !== undefined && !cond.$in.includes(value)) {
      return false;
    }
    if (cond.$nin !== undefined && cond.$nin.includes(value)) {
      return false;
    }
    return true;
  }
  // NeDB treated null and a missing field as equal.
  if (cond === null || cond === undefined) {
    return value === null || value === undefined;
  }
  return value === cond;
}

export function docMatches(doc: StoreDoc, query: StoreQuery): boolean {
  return Object.entries(query).every(([key, cond]) => conditionMatches(doc[key], cond));
}

function compareValues(a: any, b: any): number {
  if (a === b) {
    return 0;
  }
  if (a === undefined || a === null) {
    return -1;
  }
  if (b === undefined || b === null) {
    return 1;
  }
  return a < b ? -1 : 1;
}

function makeComparator(sort: Record<string, number>) {
  const entries = Object.entries(sort);
  return (a: StoreDoc, b: StoreDoc) => {
    for (const [key, direction] of entries) {
      const cmp = compareValues(a[key], b[key]);
      if (cmp !== 0) {
        return direction < 0 ? -cmp : cmp;
      }
    }
    return 0;
  };
}

// NeDB serialized Date values as {$$date: ms}; revive them to timestamps.
const nedbDateReviver = (_key: string, value: any) =>
  value !== null && typeof value === 'object' && typeof value.$$date === 'number'
    ? value.$$date
    : value;

export class SqliteStore {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, import('node:sqlite').StatementSync>();

  constructor(filename: string) {
    // getBuiltinModule loads node:sqlite even under module systems that don't know it (e.g. jest).
    const getBuiltin = (process as NodeJS.Process & { getBuiltinModule: (id: string) => unknown }).getBuiltinModule;
    const { DatabaseSync: Database } = getBuiltin('node:sqlite') as typeof import('node:sqlite');
    this.db = new Database(filename);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;'); // safe with WAL; fsync on checkpoint, not per-commit
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        _id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        parentId TEXT,
        created INTEGER NOT NULL DEFAULT 0,
        modified INTEGER NOT NULL DEFAULT 0,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_docs_type_parent ON docs (type, parentId);
      CREATE INDEX IF NOT EXISTS idx_docs_type_modified ON docs (type, modified);
    `);
  }

  // Re-preparing on every call costs more than the hot queries themselves.
  private prepare(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  isEmpty(): boolean {
    const row = this.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number };
    return row.n === 0;
  }

  find(
    type: string,
    query: StoreQuery = {},
    sort: Record<string, number> = {},
    limit: number | null = null,
  ): StoreDoc[] {
    // _id/parentId match in SQL via the hoisted columns; other keys match in JS.
    const where = ['type = ?'];
    const params: string[] = [type];
    const rest: StoreQuery = {};

    for (const [key, cond] of Object.entries(query)) {
      if (key === '_id' && typeof cond === 'string') {
        where.push('_id = ?');
        params.push(cond);
      } else if (key === 'parentId' && typeof cond === 'string') {
        where.push('parentId = ?');
        params.push(cond);
      } else if (key === 'parentId' && (cond === null || cond === undefined)) {
        where.push('parentId IS NULL');
      } else {
        rest[key] = cond;
      }
    }

    const rows = this.prepare(`SELECT json FROM docs WHERE ${where.join(' AND ')}`)
      .all(...params) as { json: string }[];

    let docs: StoreDoc[] = rows.map(row => JSON.parse(row.json));
    if (Object.keys(rest).length > 0) {
      docs = docs.filter(doc => docMatches(doc, rest));
    }
    if (Object.keys(sort).length > 0) {
      docs.sort(makeComparator(sort));
    }
    if (typeof limit === 'number' && limit >= 0) {
      docs = docs.slice(0, limit);
    }
    return docs;
  }

  count(type: string, query: StoreQuery = {}): number {
    return this.find(type, query).length;
  }

  // Writes return a detached copy (as NeDB did): callers may mutate the
  // result without aliasing the store.
  insert(doc: StoreDoc): StoreDoc {
    const json = JSON.stringify(doc);
    this.prepare('INSERT INTO docs (_id, type, parentId, created, modified, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(doc._id, doc.type, doc.parentId ?? null, doc.created ?? 0, doc.modified ?? 0, json);
    return JSON.parse(json);
  }

  update(doc: StoreDoc): StoreDoc {
    const json = JSON.stringify(doc);
    this.prepare('UPDATE docs SET type = ?, parentId = ?, created = ?, modified = ?, json = ? WHERE _id = ?')
      .run(doc.type, doc.parentId ?? null, doc.created ?? 0, doc.modified ?? 0, json, doc._id);
    return JSON.parse(json);
  }

  upsert(doc: StoreDoc): void {
    this.prepare('INSERT OR REPLACE INTO docs (_id, type, parentId, created, modified, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(doc._id, doc.type, doc.parentId ?? null, doc.created ?? 0, doc.modified ?? 0, JSON.stringify(doc));
  }

  removeByIds(ids: string[]): void {
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      this.prepare(`DELETE FROM docs WHERE _id IN (${placeholders})`).run(...chunk);
    }
  }

  transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // Legacy NeDB files are append-only NDJSON: later lines win, {$$deleted}
  // tombstones a doc, {$$indexCreated}/{$$indexRemoved} are metadata.
  importLegacyNeDBFile(type: string, filePath: string): number {
    if (!fs.existsSync(filePath)) {
      return 0;
    }
    const byId = new Map<string, StoreDoc>();
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      if (!line.trim()) {
        continue;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(line, nedbDateReviver);
      } catch {
        continue; // NeDB tolerates (and compacts away) corrupt lines
      }
      if (parsed.$$indexCreated || parsed.$$indexRemoved) {
        continue;
      }
      if (parsed.$$deleted) {
        byId.delete(parsed._id);
        continue;
      }
      if (typeof parsed._id === 'string') {
        byId.set(parsed._id, { ...parsed, type: parsed.type || type });
      }
    }
    for (const doc of byId.values()) {
      this.upsert(doc);
    }
    return byId.size;
  }

  close(): void {
    this.db.close();
  }
}
