import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import { rename, writeFile } from 'node:fs/promises';
import os from 'os';
import path from 'path';

import { version } from '../../../package.json';
import { SqliteStore } from '../../common/sqlite-store';
import { backupDataIfVersionChanged } from '../backup';

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises') as typeof import('node:fs/promises');
  return { ...actual, rename: jest.fn(), writeFile: jest.fn() };
});
const actualFs = jest.requireActual('node:fs/promises') as typeof import('node:fs/promises');
const mockRename = rename as jest.MockedFunction<typeof rename>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

const fsError = (code: string) => Object.assign(new Error(code), { code });

// Makes the first `times` renames of a path ending in `from` fail with `code`
const failRename = (from: string, code: string, times: number) => {
  mockRename.mockImplementation(async (oldPath, newPath) => {
    if (times > 0 && String(oldPath).endsWith(from)) {
      times--;
      throw fsError(code);
    }
    return actualFs.rename(oldPath, newPath);
  });
};

describe('backupDataIfVersionChanged()', () => {
  let dataPath: string;
  const marker = () => path.join(dataPath, 'last-run-version');
  const backups = () => fs.readdirSync(path.join(dataPath, 'backups')).sort();
  const backupFiles = (name: string) => fs.readdirSync(path.join(dataPath, 'backups', name)).sort();
  const backedUp = (name: string) => fs.readFileSync(path.join(dataPath, 'backups', name, 'insomnia.sqlite'), 'utf8');

  beforeEach(() => {
    dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnia-backup-'));
    process.env.INSOMNIA_DATA_PATH = dataPath;
    // resetMocks clears the implementations before each test
    mockRename.mockImplementation(actualFs.rename);
    mockWriteFile.mockImplementation(actualFs.writeFile);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.INSOMNIA_DATA_PATH;
    fs.rmSync(dataPath, { recursive: true, force: true });
  });

  it('copies the data files to backups/<previous version> when the version changed', async () => {
    fs.writeFileSync(marker(), '1.0.0\n');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite-wal'), 'wal');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite-shm'), 'shm');
    fs.writeFileSync(path.join(dataPath, 'Preferences'), '{}');

    await backupDataIfVersionChanged();

    const backupPath = path.join(dataPath, 'backups', '1.0.0');
    expect(backupFiles('1.0.0')).toEqual(['.copied-before', 'insomnia.sqlite', 'insomnia.sqlite-wal']);
    expect(fs.readFileSync(path.join(backupPath, 'insomnia.sqlite-wal'), 'utf8')).toBe('wal');
    expect(fs.readFileSync(path.join(backupPath, '.copied-before'), 'utf8')).toBe(version);
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it('copies the legacy NeDB files only while there is no SQLite database', async () => {
    fs.writeFileSync(marker(), '1.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.Request.db'), 'nedb');
    fs.mkdirSync(path.join(dataPath, 'plugin-cache.db'));

    await backupDataIfVersionChanged();
    expect(backupFiles('1.0.0')).toEqual(['.copied-before', 'insomnia.Request.db']);

    fs.writeFileSync(marker(), '2.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');
    await backupDataIfVersionChanged();
    expect(backupFiles('2.0.0')).toEqual(['.copied-before', 'insomnia.sqlite']);
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it.each(['..', '.', '../..', 'next', '-1'])('backs up to before-<version> for a marker of %j', async lastVersion => {
    fs.writeFileSync(marker(), lastVersion);
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');
    fs.mkdirSync(path.join(dataPath, 'backups', '0.9.0'), { recursive: true });
    fs.writeFileSync(path.join(dataPath, 'backups', '0.9.0', 'insomnia.sqlite'), 'old');

    await backupDataIfVersionChanged();

    expect(fs.readFileSync(path.join(dataPath, 'insomnia.sqlite'), 'utf8')).toBe('sqlite');
    expect(backups()).toEqual(['0.9.0', `before-${version}`]);
    expect(backedUp('0.9.0')).toBe('old');
    expect(backupFiles(`before-${version}`)).toEqual(['.copied-before', 'insomnia.sqlite']);
  });

  it('makes a backup that still has the writes held in the SQLite write-ahead log', async () => {
    fs.writeFileSync(marker(), '1.0.0');
    // Left open like the running app, so the write stays in insomnia.sqlite-wal
    const store = new SqliteStore(path.join(dataPath, 'insomnia.sqlite'));
    store.insert({ _id: 'req_1', type: 'Request', parentId: 'wrk_1' });

    await backupDataIfVersionChanged();
    store.close();

    const backup = new SqliteStore(path.join(dataPath, 'backups', '1.0.0', 'insomnia.sqlite'));
    expect(backup.find('Request', {}).map(doc => doc._id)).toEqual(['req_1']);
    backup.close();
  });

  it('does nothing when the version is unchanged', async () => {
    fs.writeFileSync(marker(), version);
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');

    await backupDataIfVersionChanged();

    expect(fs.existsSync(path.join(dataPath, 'backups'))).toBe(false);
  });

  it('makes no backup on a fresh install but records the version', async () => {
    await backupDataIfVersionChanged();

    expect(fs.existsSync(path.join(dataPath, 'backups'))).toBe(false);
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it('backs up data from before the version was recorded under a clear name', async () => {
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');

    await backupDataIfVersionChanged();

    expect(backups()).toEqual([`before-${version}`]);
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it('keeps only the three most recent backups', async () => {
    ['0.1.0', '0.2.0', '0.3.0'].forEach((name, i) => {
      const backupPath = path.join(dataPath, 'backups', name);
      fs.mkdirSync(backupPath, { recursive: true });
      const time = new Date(Date.now() - (10 - i) * 60_000);
      fs.utimesSync(backupPath, time, time);
    });
    fs.writeFileSync(marker(), '0.4.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');

    await backupDataIfVersionChanged();

    expect(backups()).toEqual(['0.2.0', '0.3.0', '0.4.0']);
  });

  it('keeps the backup it just made when older backups have later times', async () => {
    // Left by a clock that ran fast, and by launches that did not finish
    ['0.1.0', '0.2.0', '0.3.0', '.unfinished-0.0.1', '.replaced-0.0.2'].forEach((name, i) => {
      const backupPath = path.join(dataPath, 'backups', name);
      fs.mkdirSync(backupPath, { recursive: true });
      const time = new Date(Date.now() + (60 + i) * 60_000);
      fs.utimesSync(backupPath, time, time);
    });
    fs.writeFileSync(marker(), '0.4.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');

    await backupDataIfVersionChanged();

    expect(backups()).toEqual(['0.2.0', '0.3.0', '0.4.0']);
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it('keeps an earlier backup of the same name when a new copy fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const backupPath = path.join(dataPath, 'backups', '1.0.0');
    fs.mkdirSync(backupPath, { recursive: true });
    fs.writeFileSync(path.join(backupPath, 'insomnia.sqlite'), 'good');
    fs.writeFileSync(marker(), '1.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'sqlite');
    // An unreadable write-ahead log makes one of the copies fail
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite-wal'), 'wal', { mode: 0 });

    await backupDataIfVersionChanged();

    expect(error).toHaveBeenCalled();
    expect(backups()).toEqual(['1.0.0']);
    expect(backupFiles('1.0.0')).toEqual(['insomnia.sqlite']);
    expect(backedUp('1.0.0')).toBe('good');
  });

  it('tries a failed copy only once, as a later launch would copy data the new version has opened', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(marker(), '1.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'pre-upgrade');
    // A file where the backups folder should be makes the copy fail
    fs.writeFileSync(path.join(dataPath, 'backups'), '');

    await expect(backupDataIfVersionChanged()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);

    fs.rmSync(path.join(dataPath, 'backups'));
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'migrated-by-new-version');
    await backupDataIfVersionChanged();
    expect(fs.existsSync(path.join(dataPath, 'backups'))).toBe(false);
  });

  it('finishes a copy it could not move into place on the next launch, instead of copying again', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(marker(), '1.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'pre-upgrade');
    failRename('.unfinished-1.0.0', 'EPERM', 1);

    await backupDataIfVersionChanged();
    expect(error).toHaveBeenCalled();
    expect(backups()).toEqual(['.unfinished-1.0.0']);
    expect(fs.readFileSync(marker(), 'utf8')).toBe('1.0.0');

    // The new version opened the data after the launch that failed
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'migrated-by-new-version');
    await backupDataIfVersionChanged();
    expect(backups()).toEqual(['1.0.0']);
    expect(backedUp('1.0.0')).toBe('pre-upgrade');
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it('keeps an earlier backup of the same name whole when it cannot be moved aside', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const backupPath = path.join(dataPath, 'backups', '1.0.0');
    fs.mkdirSync(backupPath, { recursive: true });
    fs.writeFileSync(path.join(backupPath, 'insomnia.sqlite'), 'good');
    fs.writeFileSync(marker(), '1.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'pre-upgrade');
    failRename(`backups${path.sep}1.0.0`, 'EBUSY', 1);

    await backupDataIfVersionChanged();
    expect(error).toHaveBeenCalled();
    expect(backups()).toEqual(['.unfinished-1.0.0', '1.0.0']);
    expect(backedUp('1.0.0')).toBe('good');

    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'migrated-by-new-version');
    await backupDataIfVersionChanged();
    expect(backups()).toEqual(['1.0.0']);
    expect(backedUp('1.0.0')).toBe('pre-upgrade');
  });

  it('retries a rename that Windows refuses for a moment', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      fs.writeFileSync(marker(), '1.0.0');
      fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'pre-upgrade');
      failRename('.unfinished-1.0.0', 'EPERM', 3);

      await backupDataIfVersionChanged();
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }

    expect(backups()).toEqual(['1.0.0']);
    expect(backedUp('1.0.0')).toBe('pre-upgrade');
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it('does not copy again when it could not record the version after the backup', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(marker(), '1.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'pre-upgrade');
    let failures = 1;
    mockWriteFile.mockImplementation(async (file, data) => {
      if (failures > 0 && String(file).endsWith('last-run-version')) {
        failures--;
        throw fsError('ENOSPC');
      }
      return actualFs.writeFile(file, data);
    });

    await backupDataIfVersionChanged();
    expect(error).toHaveBeenCalled();
    expect(backedUp('1.0.0')).toBe('pre-upgrade');
    expect(fs.readFileSync(marker(), 'utf8')).toBe('1.0.0');

    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'migrated-by-new-version');
    await backupDataIfVersionChanged();
    expect(backedUp('1.0.0')).toBe('pre-upgrade');
    expect(fs.readFileSync(marker(), 'utf8')).toBe(version);
  });

  it('copies again when an unfinished copy was taken before a different version', async () => {
    fs.writeFileSync(marker(), '1.0.0');
    fs.writeFileSync(path.join(dataPath, 'insomnia.sqlite'), 'current');
    const unfinishedPath = path.join(dataPath, 'backups', '.unfinished-1.0.0');
    fs.mkdirSync(unfinishedPath, { recursive: true });
    fs.writeFileSync(path.join(unfinishedPath, 'insomnia.sqlite'), 'stale');
    fs.writeFileSync(path.join(unfinishedPath, '.copied-before'), '0.0.9');

    await backupDataIfVersionChanged();

    expect(backups()).toEqual(['1.0.0']);
    expect(backedUp('1.0.0')).toBe('current');
  });
});
