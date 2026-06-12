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

// Hoisted columns; sorts on these run in SQL (NULL ordering matches compareValues).
const HOISTED_SORT_COLUMNS = new Set(['_id', 'type', 'parentId', 'created', 'modified']);

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
      CREATE INDEX IF NOT EXISTS idx_docs_parent ON docs (parentId);
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

  // Hoist _id/parentId conditions (equality, null, $in) into SQL; `rest` filters in JS.
  private buildWhere(type: string, query: StoreQuery) {
    const where = ['type = ?'];
    const params: (string | number)[] = [type];
    const rest: StoreQuery = {};
    // Variable-arity IN clauses would bloat the statement cache.
    let cacheable = true;

    for (const [key, cond] of Object.entries(query)) {
      const hoisted = key === '_id' || key === 'parentId';
      if (hoisted && typeof cond === 'string') {
        where.push(`${key} = ?`);
        params.push(cond);
      } else if (key === 'parentId' && (cond === null || cond === undefined)) {
        where.push('parentId IS NULL');
      } else if (hoisted && isOperator(cond) && Array.isArray(cond.$in) && cond.$in.every(v => typeof v === 'string')) {
        if (cond.$in.length === 0) {
          where.push('1 = 0'); // $in [] matches nothing
        } else {
          where.push(`${key} IN (${cond.$in.map(() => '?').join(', ')})`);
          params.push(...cond.$in);
          cacheable = false;
        }
        const restOps: OperatorQuery = { ...cond };
        delete restOps.$in;
        if (Object.keys(restOps).length > 0) {
          rest[key] = restOps;
        }
      } else {
        rest[key] = cond;
      }
    }
    return { where, params, rest, cacheable };
  }

  // Tolerate a corrupt row (disk fault / partial write) by skipping it rather
  // than failing the whole query, mirroring the legacy importer.
  private parseRows(rows: { json: string }[]): StoreDoc[] {
    const out: StoreDoc[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.json));
      } catch (err) {
        console.warn('[sqlite-store] skipping unparseable doc row', err);
      }
    }
    return out;
  }

  find(
    type: string,
    query: StoreQuery = {},
    sort: Record<string, number> = {},
    limit: number | null = null,
  ): StoreDoc[] {
    const { where, params, rest, cacheable } = this.buildWhere(type, query);
    const needsJsFilter = Object.keys(rest).length > 0;

    const sortEntries = Object.entries(sort);
    const sqlSort = sortEntries.length > 0 && sortEntries.every(([key]) => HOISTED_SORT_COLUMNS.has(key));
    // LIMIT in SQL is only safe when all filtering happened in SQL.
    const sqlLimit = typeof limit === 'number' && limit >= 0 && !needsJsFilter
      && (sqlSort || sortEntries.length === 0);

    let sql = `SELECT json FROM docs WHERE ${where.join(' AND ')}`;
    if (sqlSort) {
      sql += ` ORDER BY ${sortEntries.map(([key, direction]) => `${key} ${direction < 0 ? 'DESC' : 'ASC'}`).join(', ')}`;
    }
    if (sqlLimit && typeof limit === 'number') {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    const statement = cacheable ? this.prepare(sql) : this.db.prepare(sql);
    const rows = statement.all(...params) as { json: string }[];

    let docs: StoreDoc[] = this.parseRows(rows);
    if (needsJsFilter) {
      docs = docs.filter(doc => docMatches(doc, rest));
    }
    if (!sqlSort && sortEntries.length > 0) {
      docs.sort(makeComparator(sort));
    }
    if (!sqlLimit && typeof limit === 'number' && limit >= 0) {
      docs = docs.slice(0, limit);
    }
    return docs;
  }

  count(type: string, query: StoreQuery = {}): number {
    const { where, params, rest, cacheable } = this.buildWhere(type, query);
    if (Object.keys(rest).length > 0) {
      // Count via the JS predicate without materializing a doc array.
      const sql = `SELECT json FROM docs WHERE ${where.join(' AND ')}`;
      const statement = cacheable ? this.prepare(sql) : this.db.prepare(sql);
      const rows = statement.all(...params) as { json: string }[];
      let n = 0;
      for (const doc of this.parseRows(rows)) {
        if (docMatches(doc, rest)) {
          n++;
        }
      }
      return n;
    }
    const sql = `SELECT COUNT(*) AS n FROM docs WHERE ${where.join(' AND ')}`;
    const statement = cacheable ? this.prepare(sql) : this.db.prepare(sql);
    return (statement.get(...params) as { n: number }).n;
  }

  // Transitive descendants of rootId (root excluded), level-ordered like the
  // old BFS. stopType nodes are returned but not descended into; rootType lets
  // the seed honor that. The depth cap bounds cycles - depth defeats UNION dedup.
  findDescendants(
    rootId: string,
    options: { types?: string[]; stopType?: string | null; rootType?: string } = {},
  ): StoreDoc[] {
    const { types = [], stopType = null, rootType = '' } = options;
    const typeFilter = types.length > 0 ? ` AND docs.type IN (${types.map(() => '?').join(', ')})` : '';
    const sql = `
      WITH RECURSIVE tree(_id, type, depth) AS (
        SELECT ?, ?, 0
        UNION
        SELECT d._id, d.type, t.depth + 1 FROM docs d
        JOIN tree t ON d.parentId = t._id
        WHERE t.type IS NOT ? AND t.depth < 64
      )
      SELECT docs.json FROM (SELECT _id, MIN(depth) AS depth FROM tree GROUP BY _id) m
      CROSS JOIN docs ON docs._id = m._id
      WHERE docs._id != ?${typeFilter}
      ORDER BY m.depth, docs.created, docs._id
    `;
    // typeFilter arity varies with types.length; cache only the fixed no-types SQL.
    const statement = types.length > 0 ? this.db.prepare(sql) : this.prepare(sql);
    const rows = statement.all(rootId, rootType, stopType, rootId, ...types) as { json: string }[];
    return this.parseRows(rows);
  }

  // Writes return a detached copy (as NeDB did): callers may mutate the
  // result without aliasing the store.
  insert(doc: StoreDoc): StoreDoc {
    const json = JSON.stringify(doc);
    this.prepare('INSERT INTO docs (_id, type, parentId, created, modified, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(doc._id, doc.type, doc.parentId ?? null, doc.created ?? 0, doc.modified ?? 0, json);
    return JSON.parse(json);
  }

  // Returns null when the row doesn't exist (e.g. deleted concurrently).
  update(doc: StoreDoc): StoreDoc | null {
    const json = JSON.stringify(doc);
    const { changes } = this.prepare('UPDATE docs SET type = ?, parentId = ?, created = ?, modified = ?, json = ? WHERE _id = ?')
      .run(doc.type, doc.parentId ?? null, doc.created ?? 0, doc.modified ?? 0, json, doc._id);
    return Number(changes) === 0 ? null : JSON.parse(json);
  }

  // Atomic insert-or-replace; returns a detached copy like insert/update.
  upsert(doc: StoreDoc): StoreDoc {
    const json = JSON.stringify(doc);
    this.prepare('INSERT OR REPLACE INTO docs (_id, type, parentId, created, modified, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(doc._id, doc.type, doc.parentId ?? null, doc.created ?? 0, doc.modified ?? 0, json);
    return JSON.parse(json);
  }

  removeByIds(ids: string[]): void {
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      // Arity varies (esp. the final chunk); prepare uncached to avoid cache bloat.
      this.db.prepare(`DELETE FROM docs WHERE _id IN (${placeholders})`).run(...chunk);
    }
  }

  // Strictly synchronous: node:sqlite has one connection-level transaction, so
  // an async fn would COMMIT before its writes run - guard against a thenable.
  transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      const result = fn() as unknown;
      if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('transaction(fn) requires a synchronous callback; it returned a Promise, which would commit before the work completed.');
      }
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
