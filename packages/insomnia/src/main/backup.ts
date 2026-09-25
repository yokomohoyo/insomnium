import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import electron from 'electron';

import { version } from '../../package.json';

// Holds the version that last ran, so a launch can tell the app was upgraded
const LAST_VERSION_FILE = 'last-run-version';
// Inside a backup, holds the version whose first launch took the copy
const COPIED_BEFORE_FILE = '.copied-before';
const BACKUPS_TO_KEEP = 3;
// A backup is copied into a folder with this prefix, then renamed into place
const UNFINISHED_PREFIX = '.unfinished-';
// An older backup of the same name waits here while the new one takes its place
const REPLACED_PREFIX = '.replaced-';
const RENAME_RETRY_MS = 5_000;

const getDataPath = () => process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData');

// The SQLite database and its write-ahead log (recent writes stay there until a checkpoint).
// The legacy NeDB files only matter until the SQLite database exists: after that the app
// never writes them again, and they stay in the data folder.
async function listDataFiles(dataPath: string) {
  let files: string[];
  try {
    files = (await readdir(dataPath, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  const hasSqlite = files.includes('insomnia.sqlite');
  return files.filter(file => file === 'insomnia.sqlite' || file === 'insomnia.sqlite-wal' || (!hasSqlite && file.endsWith('.db')));
}

const copiedBefore = (backupPath: string) =>
  readFile(path.join(backupPath, COPIED_BEFORE_FILE), 'utf8').then(text => text.trim(), () => '');

// Only marked as copied once every copy has finished
async function copyDataFiles(dataPath: string, files: string[], unfinishedPath: string) {
  await rm(unfinishedPath, { recursive: true, force: true });
  await mkdir(unfinishedPath, { recursive: true });
  // Wait for every copy, even after one fails, so none is still writing when the folder is removed
  const errors = await Promise.all(files.map(file =>
    copyFile(path.join(dataPath, file), path.join(unfinishedPath, file)).then(() => null, (err: Error) => err)
  ));
  const error = errors.find(err => err);
  if (error) {
    await rm(unfinishedPath, { recursive: true, force: true });
    throw error;
  }
  await writeFile(path.join(unfinishedPath, COPIED_BEFORE_FILE), version);
}

// Windows can refuse to rename a folder for a while after files were written into it,
// for example while antivirus scans them. graceful-fs retries for the same reason.
async function renameWithRetry(from: string, to: string) {
  const start = Date.now();
  for (let wait = 10; ; wait = Math.min(wait + 10, 100)) {
    try {
      return await rename(from, to);
    } catch (err) {
      const busy = process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(err.code);
      if (!busy || Date.now() - start >= RENAME_RETRY_MS) {
        throw err;
      }
    }
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

// Replaced, not merged, so an old write-ahead log is never paired with a newer database.
// Every step is a rename, so a failure leaves each copy whole, and the next launch finishes.
async function moveIntoPlace(unfinishedPath: string, backupPath: string) {
  const replacedPath = path.join(path.dirname(backupPath), REPLACED_PREFIX + path.basename(backupPath));
  await rm(replacedPath, { recursive: true, force: true });
  await renameWithRetry(backupPath, replacedPath).catch(err => {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  });
  await renameWithRetry(unfinishedPath, backupPath);
  await rm(replacedPath, { recursive: true, force: true });
}

// Keeps the backup just made plus the newest others, BACKUPS_TO_KEEP in all
async function pruneBackups(backupsPath: string, keep: string) {
  const entries = (await readdir(backupsPath, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name !== keep);
  // Left behind by an earlier launch that did not finish. A backup name never starts with '.'.
  const leftovers = entries.filter(entry => entry.name.startsWith('.')).map(entry => path.join(backupsPath, entry.name));
  const others = await Promise.all(entries.filter(entry => !entry.name.startsWith('.')).map(async entry => {
    const backupPath = path.join(backupsPath, entry.name);
    return { backupPath, modified: (await stat(backupPath)).mtimeMs };
  }));
  const old = others.sort((a, b) => b.modified - a.modified).slice(BACKUPS_TO_KEEP - 1).map(({ backupPath }) => backupPath);
  await Promise.all([...leftovers, ...old].map(backupPath => rm(backupPath, { recursive: true, force: true })));
}

async function recordVersion(dataPath: string) {
  await mkdir(dataPath, { recursive: true });
  await writeFile(path.join(dataPath, LAST_VERSION_FILE), version);
}

// On the first launch of a different version, copy the data to backups/<previous version>.
// Runs before the database opens or migrates anything, and never throws.
export async function backupDataIfVersionChanged() {
  try {
    const dataPath = getDataPath();
    const lastVersion = await readFile(path.join(dataPath, LAST_VERSION_FILE), 'utf8').then(text => text.trim(), () => '');
    if (lastVersion === version) {
      return;
    }
    const backupsPath = path.join(dataPath, 'backups');
    // The marker becomes a folder name, so only a version is used. Without a marker the data
    // comes from a version that did not record itself.
    const name = /^\d[\w.+-]*$/.test(lastVersion) ? lastVersion : `before-${version}`;
    const backupPath = path.join(backupsPath, name);
    const unfinishedPath = path.join(backupsPath, UNFINISHED_PREFIX + name);
    // A launch of this version that took the copy but could not move it into place or record
    // the version has already opened the data, so its copy is finished rather than taken again
    if (await copiedBefore(backupPath) !== version) {
      if (await copiedBefore(unfinishedPath) !== version) {
        const files = await listDataFiles(dataPath);
        if (!files.length) {
          // A fresh install
          await recordVersion(dataPath);
          return;
        }
        try {
          await copyDataFiles(dataPath, files, unfinishedPath);
        } catch (err) {
          console.error('[backup] Failed to back up data', err);
          // This launch goes on to open the data, so a copy taken by a later launch would not
          // hold the data from before the upgrade. Recorded so it is not tried again.
          await recordVersion(dataPath);
          return;
        }
      }
      await moveIntoPlace(unfinishedPath, backupPath);
      console.log('[backup] Backed up data to', backupPath);
    }
    await recordVersion(dataPath);
    await pruneBackups(backupsPath, name);
  } catch (err) {
    console.error('[backup] Failed to back up data', err);
  }
}
