/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { database } from '../../common/database';
import * as models from '../../models';
import { listSnapshots, restorePendingSnapshot, SNAPSHOTS_TO_KEEP, snapshotIfDue, takeSnapshot } from '../snapshots';

jest.mock('electron');

// as sqlite-store does: jest's module system doesn't know node:sqlite
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
// what a database file holds, read without the app
const workspaceNames = (file: string) => {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare("SELECT json FROM docs WHERE type = 'Workspace'").all() as { json: string }[]).map(({ json }) => JSON.parse(json).name).sort();
  } finally {
    db.close();
  }
};

describe('snapshots', () => {
  let dataPath: string;
  let previous: string | undefined;

  beforeEach(async () => {
    dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-snapshots-'));
    previous = process.env.INSOMNIA_DATA_PATH;
    process.env.INSOMNIA_DATA_PATH = dataPath;
    await database.init(models.types(), {}, true, () => {});
    await models.project.all();
  });

  afterEach(async () => {
    // let go of the file before it's removed
    await database.init(models.types(), { inMemoryOnly: true }, true, () => {});
    if (previous === undefined) {
      delete process.env.INSOMNIA_DATA_PATH;
    } else {
      process.env.INSOMNIA_DATA_PATH = previous;
    }
    fs.rmSync(dataPath, { recursive: true, force: true });
  });

  const snapshotsPath = () => path.join(dataPath, 'backups', 'snapshots');

  it('copies the open database, with what it holds', async () => {
    await models.workspace.create({ name: 'Kept' });
    const name = await takeSnapshot();
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.sqlite$/);
    expect(workspaceNames(path.join(snapshotsPath(), name))).toEqual(['Kept']);
    expect((await listSnapshots()).map(snapshot => snapshot.name)).toEqual([name]);
    expect(await takeSnapshot('manual')).toMatch(/Z-manual\.sqlite$/);
  });

  it('takes one a day, and keeps the newest seven', async () => {
    const day = (n: number) => Date.parse(`2026-10-${String(n).padStart(2, '0')}T09:00:00Z`);
    await snapshotIfDue(day(1));
    // not yet a day later
    await snapshotIfDue(day(1) + 23 * 60 * 60 * 1000);
    expect(await listSnapshots()).toHaveLength(1);

    for (let n = 2; n <= 10; n++) {
      await snapshotIfDue(day(n));
    }
    const kept = await listSnapshots();
    expect(kept).toHaveLength(SNAPSHOTS_TO_KEEP);
    expect(kept.map(({ name }) => name.slice(8, 10))).toEqual(['10', '09', '08', '07', '06', '05', '04']);
    expect(kept[0]).toMatchObject({ name: '2026-10-10T09-00-00Z.sqlite', created: day(10) });
    expect(fs.readdirSync(snapshotsPath()).filter(name => name.startsWith('.'))).toEqual([]);
  });

  it('restores the snapshot a restart was asked for, before the database opens', async () => {
    await models.workspace.create({ name: 'Before' });
    const name = await takeSnapshot();
    await models.workspace.create({ name: 'After' });
    // the restart: the database is closed, then restored before it opens
    await database.init(models.types(), { inMemoryOnly: true }, true, () => {});
    fs.writeFileSync(path.join(dataPath, 'restore-snapshot'), name);

    await restorePendingSnapshot();

    expect(workspaceNames(path.join(dataPath, 'insomnia.sqlite'))).toEqual(['Before']);
    expect(fs.existsSync(path.join(dataPath, 'restore-snapshot'))).toBe(false);
    expect(fs.readdirSync(dataPath).filter(file => /\.(replaced|restoring)$/.test(file))).toEqual([]);
  });

  it('leaves the data as it was when the snapshot is missing or not one', async () => {
    await models.workspace.create({ name: 'Current' });
    await database.init(models.types(), { inMemoryOnly: true }, true, () => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    for (const name of ['2026-01-01T00-00-00Z.sqlite', '../insomnia.sqlite']) {
      fs.writeFileSync(path.join(dataPath, 'restore-snapshot'), name);
      await restorePendingSnapshot();
      expect(workspaceNames(path.join(dataPath, 'insomnia.sqlite'))).toEqual(['Current']);
      expect(fs.existsSync(path.join(dataPath, 'restore-snapshot'))).toBe(false);
    }
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
