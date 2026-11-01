// Puts a fixture straight into the (in-memory) database, with the metas the
// app makes once requests and folders have been opened.
import { database } from '../common/database';
import * as models from '../models';
import type { BaseModel } from '../models';
import { type CollectionOptions, largeCollection, MODEL_TYPES } from './fixtures';

export async function seedCollection(options: CollectionOptions = {}) {
  const project = await models.project.create({ name: 'Perf' });
  const { resources } = largeCollection(options);
  const upsert: BaseModel[] = [];
  for (const { _type, ...doc } of resources) {
    const type = MODEL_TYPES[_type];
    upsert.push(await models.initModel(type, { ...doc, type, parentId: doc.parentId ?? project._id }));
    if (_type === 'request') {
      upsert.push(await models.initModel(models.requestMeta.type, { parentId: doc._id, pinned: Number(doc.metaSortKey) === 0 }));
    } else if (_type === 'request_group') {
      upsert.push(await models.initModel(models.requestGroupMeta.type, { parentId: doc._id, collapsed: false }));
    }
  }
  await database.batchModifyDocs({ upsert });
  const workspace = await models.workspace.getById('wrk_perf');
  return { project, workspace: workspace!, requests: resources.filter(r => r._type === 'request').length };
}

/** Runs fn `runs` times (after one warm-up) and gives the median in ms. */
export async function median(fn: () => unknown, runs = 5) {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)];
}

export const report = (label: string, ms: number) => console.log(`${label}: ${ms.toFixed(1)} ms`);
