import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as models from '../../models';
import { database as db } from '../database';
import { SqliteStore } from '../sqlite-store';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  const doc = (id: string, extra: Record<string, any> = {}) => ({
    _id: id,
    type: 'Request',
    parentId: 'wrk_1',
    created: 100,
    modified: 200,
    ...extra,
  });

  it('round-trips documents', () => {
    store.insert(doc('req_1', { name: 'foo', nested: { a: [1, 2] } }));
    const found = store.find('Request', { _id: 'req_1' });
    expect(found).toEqual([doc('req_1', { name: 'foo', nested: { a: [1, 2] } })]);
  });

  it('filters by parentId including null', () => {
    store.insert(doc('req_1'));
    store.insert(doc('req_2', { parentId: 'wrk_2' }));
    store.insert(doc('req_3', { parentId: null }));
    expect(store.find('Request', { parentId: 'wrk_1' }).map(d => d._id)).toEqual(['req_1']);
    expect(store.find('Request', { parentId: null }).map(d => d._id)).toEqual(['req_3']);
  });

  it('supports $gt, $in and $nin operators', () => {
    store.insert(doc('req_1', { metaSortKey: 1 }));
    store.insert(doc('req_2', { metaSortKey: 2 }));
    store.insert(doc('req_3', { metaSortKey: 3 }));
    expect(store.find('Request', { metaSortKey: { $gt: 1 } }).map(d => d._id)).toEqual(['req_2', 'req_3']);
    expect(store.find('Request', { _id: { $in: ['req_1', 'req_3'] } }).map(d => d._id)).toEqual(['req_1', 'req_3']);
    expect(store.find('Request', { _id: { $nin: ['req_2'] } }).map(d => d._id)).toEqual(['req_1', 'req_3']);
  });

  it('sorts and limits', () => {
    store.insert(doc('req_1', { created: 3 }));
    store.insert(doc('req_2', { created: 1 }));
    store.insert(doc('req_3', { created: 2 }));
    expect(store.find('Request', {}, { created: 1 }).map(d => d._id)).toEqual(['req_2', 'req_3', 'req_1']);
    expect(store.find('Request', {}, { created: -1 }, 2).map(d => d._id)).toEqual(['req_1', 'req_3']);
  });

  it('handles $in on hoisted columns, including empty and combined operators', () => {
    store.insert(doc('req_1'));
    store.insert(doc('req_2', { parentId: 'wrk_2' }));
    store.insert(doc('req_3', { parentId: 'wrk_3' }));
    expect(store.find('Request', { parentId: { $in: ['wrk_1', 'wrk_3'] } }).map(d => d._id)).toEqual(['req_1', 'req_3']);
    expect(store.find('Request', { _id: { $in: [] } })).toEqual([]);
    expect(store.find('Request', { _id: { $in: ['req_1', 'req_2'], $nin: ['req_2'] } }).map(d => d._id)).toEqual(['req_1']);
  });

  it('applies limit only after non-hoisted filters', () => {
    // The newest doc fails the filter; a premature SQL LIMIT would return [].
    store.insert(doc('req_1', { created: 1, metaSortKey: 0 }));
    store.insert(doc('req_2', { created: 2, metaSortKey: 9 }));
    store.insert(doc('req_3', { created: 3, metaSortKey: 0 }));
    expect(store.find('Request', { metaSortKey: { $gt: 1 } }, { created: -1 }, 1).map(d => d._id)).toEqual(['req_2']);
  });

  it('sorts by non-hoisted keys in JS', () => {
    store.insert(doc('req_1', { name: 'b' }));
    store.insert(doc('req_2', { name: 'a' }));
    expect(store.find('Request', {}, { name: 1 }).map(d => d._id)).toEqual(['req_2', 'req_1']);
  });

  it('counts with hoisted and non-hoisted queries', () => {
    store.insert(doc('req_1'));
    store.insert(doc('req_2', { parentId: 'wrk_2', metaSortKey: 5 }));
    store.insert(doc('req_3', { parentId: 'wrk_2' }));
    expect(store.count('Request', { parentId: 'wrk_2' })).toBe(2);
    expect(store.count('Request', { metaSortKey: { $gt: 1 } })).toBe(1);
  });

  it('returns null when updating a missing doc', () => {
    expect(store.update(doc('req_ghost'))).toBeNull();
  });

  it('updates and removes', () => {
    store.insert(doc('req_1', { name: 'before' }));
    store.update(doc('req_1', { name: 'after' }));
    expect(store.find('Request', { _id: 'req_1' })[0].name).toBe('after');
    store.removeByIds(['req_1']);
    expect(store.count('Request')).toBe(0);
  });

  it('returns detached copies on write', () => {
    const inserted = store.insert(doc('req_1', { headers: [{ name: 'a' }] }));
    inserted.headers.push({ name: 'b' });
    expect(store.find('Request', { _id: 'req_1' })[0].headers).toEqual([{ name: 'a' }]);
  });

  it('upsert inserts then replaces, returning a detached copy', () => {
    const a = store.upsert(doc('req_1', { name: 'first' }));
    expect(a.name).toBe('first');
    a.name = 'mutated';
    expect(store.find('Request', { _id: 'req_1' })[0].name).toBe('first');
    store.upsert(doc('req_1', { name: 'second' }));
    expect(store.count('Request', { _id: 'req_1' })).toBe(1);
    expect(store.find('Request', { _id: 'req_1' })[0].name).toBe('second');
  });

  describe('transaction', () => {
    it('commits all writes on success', () => {
      store.transaction(() => {
        store.insert(doc('req_1'));
        store.insert(doc('req_2'));
      });
      expect(store.count('Request')).toBe(2);
    });

    it('rolls the whole batch back on failure', () => {
      store.insert(doc('req_1'));
      expect(() => store.transaction(() => {
        store.insert(doc('req_2'));
        store.insert(doc('req_1')); // duplicate PK -> throws mid-transaction
      })).toThrow();
      // req_2 must not survive the rollback.
      expect(store.find('Request', {}, { _id: 1 }).map(d => d._id)).toEqual(['req_1']);
    });

    it('rejects an async callback instead of silently losing atomicity', () => {
      expect(() => store.transaction((() => Promise.resolve()) as () => void)).toThrow(/synchronous/);
    });
  });

  describe('findDescendants', () => {
    const seed = () => {
      // wrk_1 > fld_a > fld_b > req_deep ; wrk_1 > req_top ; wrk_2 > req_other
      store.insert({ _id: 'wrk_1', type: 'Workspace', parentId: 'proj_1', created: 1, modified: 1 });
      store.insert({ _id: 'fld_a', type: 'RequestGroup', parentId: 'wrk_1', created: 2, modified: 2 });
      store.insert({ _id: 'fld_b', type: 'RequestGroup', parentId: 'fld_a', created: 3, modified: 3 });
      store.insert({ _id: 'req_deep', type: 'Request', parentId: 'fld_b', created: 4, modified: 4 });
      store.insert({ _id: 'req_top', type: 'Request', parentId: 'wrk_1', created: 5, modified: 5 });
      store.insert({ _id: 'wrk_2', type: 'Workspace', parentId: 'proj_1', created: 6, modified: 6 });
      store.insert({ _id: 'req_other', type: 'Request', parentId: 'wrk_2', created: 7, modified: 7 });
      store.insert({ _id: 'req_orphan', type: 'Request', parentId: 'fld_gone', created: 8, modified: 8 });
    };

    it('returns nested descendants level-ordered, excluding the root, other trees and orphans', () => {
      seed();
      const all = store.findDescendants('wrk_1');
      expect(all.map(d => d._id)).toEqual(['fld_a', 'req_top', 'fld_b', 'req_deep']);
    });

    it('filters by types', () => {
      seed();
      const reqs = store.findDescendants('wrk_1', { types: ['Request'] });
      expect(reqs.map(d => d._id)).toEqual(['req_top', 'req_deep']);
    });

    it('terminates on parentId cycles', () => {
      store.insert({ _id: 'fld_x', type: 'RequestGroup', parentId: 'fld_y', created: 1, modified: 1 });
      store.insert({ _id: 'fld_y', type: 'RequestGroup', parentId: 'fld_x', created: 2, modified: 2 });
      store.insert({ _id: 'req_1', type: 'Request', parentId: 'fld_x', created: 3, modified: 3 });
      expect(store.findDescendants('fld_y').map(d => d._id)).toEqual(['fld_x', 'req_1']);
    });

    it('includes stopType nodes but does not descend into them', () => {
      seed();
      store.insert({ _id: 'res_1', type: 'Response', parentId: 'req_deep', created: 9, modified: 9 });
      const docs = store.findDescendants('wrk_1', { stopType: 'Request', rootType: 'Workspace' });
      expect(docs.map(d => d._id)).toEqual(['fld_a', 'req_top', 'fld_b', 'req_deep']);
    });

    it('returns nothing when the root itself is of stopType', () => {
      seed();
      expect(store.findDescendants('fld_a', { stopType: 'RequestGroup', rootType: 'RequestGroup' })).toEqual([]);
    });
  });

  describe('importLegacyNeDBFile', () => {
    it('imports last-write-wins, honors tombstones, skips metadata and corrupt lines', () => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nedb-import-')), 'insomnia.Request.db');
      fs.writeFileSync(file, [
        JSON.stringify({ $$indexCreated: { fieldName: '_id', unique: true } }),
        JSON.stringify({ _id: 'req_1', type: 'Request', name: 'first' }),
        JSON.stringify({ _id: 'req_2', type: 'Request', name: 'doomed' }),
        JSON.stringify({ _id: 'req_1', type: 'Request', name: 'second', when: { $$date: 1700000000000 } }),
        '{ corrupt json',
        JSON.stringify({ _id: 'req_2', $$deleted: true }),
        JSON.stringify({ _id: 'req_3', name: 'untyped' }),
      ].join('\n'));

      const count = store.importLegacyNeDBFile('Request', file);
      expect(count).toBe(2);
      const docs = store.find('Request', {}, { _id: 1 });
      expect(docs.map(d => d._id)).toEqual(['req_1', 'req_3']);
      expect(docs[0].name).toBe('second');
      expect(docs[0].when).toBe(1700000000000);
      expect(docs[1].type).toBe('Request'); // falls back to the file's type
    });

    it('returns 0 for missing files', () => {
      expect(store.importLegacyNeDBFile('Request', '/nope/insomnia.Request.db')).toBe(0);
    });
  });
});

describe('database.init() NeDB migration', () => {
  const realDataPath = process.env['INSOMNIA_DATA_PATH'];

  afterEach(async () => {
    if (realDataPath === undefined) {
      delete process.env['INSOMNIA_DATA_PATH'];
    } else {
      process.env['INSOMNIA_DATA_PATH'] = realDataPath;
    }
    // Leave a fresh in-memory DB behind for any suites that follow.
    await db.init(models.types(), { inMemoryOnly: true }, true, () => {});
  });

  it('imports legacy NeDB files into a fresh SQLite DB exactly once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nedb-migration-'));
    process.env['INSOMNIA_DATA_PATH'] = dir;
    fs.writeFileSync(path.join(dir, 'insomnia.Request.db'), JSON.stringify({
      _id: 'req_legacy',
      type: 'Request',
      parentId: 'wrk_legacy',
      name: 'Legacy request',
      url: 'http://localhost',
      method: 'GET',
      created: 1700000000000,
      modified: 1700000000000,
    }) + '\n');

    await db.init(models.types(), {}, true, () => {});
    const migrated = await models.request.getById('req_legacy');
    expect(migrated?.name).toBe('Legacy request');

    // Data persists in SQLite across a re-init, and the import doesn't run twice.
    await models.request.create({ parentId: 'wrk_legacy', name: 'Post-migration request' });
    await db.init(models.types(), {}, true, () => {});
    const requests = await db.find(models.request.type, { parentId: 'wrk_legacy' });
    expect(requests.length).toBe(2);
  });
});
