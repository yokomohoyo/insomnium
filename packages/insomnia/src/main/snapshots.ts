import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from 'node:process';

import electron from 'electron';

import { snapshotDatabaseTo } from '../common/database';

// Daily snapshots of the database, so a deleted workspace or a bad import can
// be undone without a cloud copy. Taken while the app runs, with SQLite's
// VACUUM INTO, which copies the open database consistently. A snapshot holds
// the encrypted credentials and the keys they're wrapped with, so it restores
// on this machine.

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
export const SNAPSHOTS_TO_KEEP = 7;
// in the data folder: the snapshot the next launch restores
const PENDING_RESTORE_FILE = 'restore-snapshot';
const DB_FILE = 'insomnia.sqlite';
const SNAPSHOT_NAME = /^[\w.-]+\.sqlite$/;

const getDataPath = () => env.INSOMNIA_DATA_PATH || electron.app.getPath('userData');
export const getSnapshotsPath = () => path.join(getDataPath(), 'backups', 'snapshots');

export interface Snapshot {
  name: string;
  created: number;
  size: number;
}

// Newest first
export async function listSnapshots(): Promise<Snapshot[]> {
  let names: string[];
  try {
    names = await readdir(getSnapshotsPath());
  } catch {
    return [];
  }
  const snapshots = await Promise.all(names
    .filter(name => SNAPSHOT_NAME.test(name) && !name.startsWith('.'))
    .map(async name => {
      const { mtimeMs, size } = await stat(path.join(getSnapshotsPath(), name));
      // when it was taken, from its name; the file's time if it's been renamed
      const stamp = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})Z/);
      const taken = stamp ? Date.parse(`${stamp[1]}:${stamp[2]}:${stamp[3]}Z`) : NaN;
      return { name, created: Number.isNaN(taken) ? mtimeMs : taken, size };
    }));
  return snapshots.sort((a, b) => b.created - a.created);
}

// Keeps the newest, and clears what an unfinished snapshot left
async function prune() {
  const keep = new Set((await listSnapshots()).slice(0, SNAPSHOTS_TO_KEEP).map(({ name }) => name));
  const names = await readdir(getSnapshotsPath());
  await Promise.all(names
    .filter(name => (SNAPSHOT_NAME.test(name) && !keep.has(name)) || name.startsWith('.unfinished-'))
    .map(name => rm(path.join(getSnapshotsPath(), name), { force: true })));
}

// Named for when it was taken, 2026-10-18T09-30-00Z.sqlite, and why when it's
// not one of the daily ones
export async function takeSnapshot(reason = '', at = new Date()) {
  const dir = getSnapshotsPath();
  await mkdir(dir, { recursive: true });
  const stamp = at.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  const name = `${stamp}${reason ? `-${reason}` : ''}.sqlite`;
  const unfinished = path.join(dir, `.unfinished-${name}`);
  await rm(unfinished, { force: true });
  snapshotDatabaseTo(unfinished);
  await rename(unfinished, path.join(dir, name));
  await prune();
  return name;
}

export async function snapshotIfDue(now = Date.now()) {
  try {
    const [newest] = await listSnapshots();
    if (!newest || now - newest.created >= DAY_MS) {
      console.log('[snapshots] Took', await takeSnapshot('', new Date(now)));
    }
  } catch (err) {
    console.error('[snapshots] Could not take a snapshot', err);
  }
}

// One now if the last is a day old, then a look each hour
export function scheduleSnapshots() {
  snapshotIfDue();
  setInterval(snapshotIfDue, CHECK_EVERY_MS).unref();
}

// The database can't be replaced while it's open, so the next launch does it,
// before opening it. What's there now is snapshotted first, so a restore can
// be undone too.
export async function restoreSnapshotOnRestart(name: string) {
  if (!(await listSnapshots()).some(snapshot => snapshot.name === name)) {
    throw new Error(`There's no snapshot ${name}`);
  }
  await takeSnapshot('before-restore');
  await writeFile(path.join(getDataPath(), PENDING_RESTORE_FILE), name);
  electron.app.relaunch();
  electron.app.exit(0);
}

const exists = (file: string) => stat(file).then(() => true, () => false);

// At launch, before the database opens: swap in the snapshot a restore asked
// for. The database and its write-ahead log are moved aside, not deleted,
// until the snapshot is in place, so a failure leaves them as they were.
export async function restorePendingSnapshot() {
  const dataPath = getDataPath();
  const marker = path.join(dataPath, PENDING_RESTORE_FILE);
  const name = await readFile(marker, 'utf8').then(text => text.trim(), () => '');
  if (!name) {
    return;
  }
  const target = path.join(dataPath, DB_FILE);
  const moved: [string, string][] = [];
  try {
    if (!SNAPSHOT_NAME.test(name)) {
      throw new Error(`Not a snapshot: ${name}`);
    }
    const restoring = `${target}.restoring`;
    await copyFile(path.join(getSnapshotsPath(), name), restoring);
    for (const file of [target, `${target}-wal`, `${target}-shm`]) {
      if (await exists(file)) {
        await rename(file, `${file}.replaced`);
        moved.push([file, `${file}.replaced`]);
      }
    }
    await rename(restoring, target);
    console.log('[snapshots] Restored', name);
    // what's left aside is only clutter now; the snapshot before the restore holds it
    await Promise.all(moved.map(([, aside]) => rm(aside, { force: true }).catch(() => {})));
  } catch (err) {
    console.error('[snapshots] Could not restore', name, err);
    for (const [file, aside] of moved.reverse()) {
      await rename(aside, file).catch(() => {});
    }
    await rm(`${target}.restoring`, { force: true });
  } finally {
    await rm(marker, { force: true });
  }
}
