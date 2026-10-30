import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type FSWraps =
  | typeof fs.promises.readFile
  | typeof fs.promises.writeFile
  | typeof fs.promises.unlink
  | typeof fs.promises.readdir
  | typeof fs.promises.mkdir
  | typeof fs.promises.rmdir
  | typeof fs.promises.stat
  | typeof fs.promises.lstat
  | typeof fs.promises.readlink
  | typeof fs.promises.symlink;

// where a write waits to replace its file: in the store, so it goes with it,
// and left out of its listing, so git (which lists refs/heads and walks the
// work tree) never sees it
const WRITES_DIR = '.insomnium-writes';

// isomorphic-git rewrites HEAD, refs and the index in place, and a plain write
// empties the file first: a read meanwhile (the branch shown, the status) finds
// no HEAD. Written aside and renamed over it, a file is either old or new.
const atomicWriter = (writesDir: string) => async (filePath: string, ...args: any[]) => {
  await fs.promises.mkdir(writesDir, { recursive: true });
  const temp = path.join(writesDir, crypto.randomBytes(16).toString('hex'));
  const [data, options] = args;
  const { mode, ...rest }: { mode?: number; [option: string]: unknown } = typeof options === 'string' ? { encoding: options } : options || {};
  // new, and the owner's only (the store can sit in the OS temp folder): an
  // executable keeps its bit, which is all git records of a file's mode
  await fs.promises.writeFile(temp, data, { ...rest, flag: 'wx', mode: (mode ?? 0) & 0o100 ? 0o700 : 0o600 });
  try {
    await fs.promises.rename(temp, filePath);
  } catch {
    await fs.promises.unlink(temp).catch(() => {});
    // a rename refused (Windows, the file held open) still gets the write
    // @ts-expect-error -- TSCONVERSION
    await fs.promises.writeFile(filePath, ...args);
  }
};

/** This is a client for isomorphic-git. {@link https://isomorphic-git.org/docs/en/fs} */
export const fsClient = (basePath: string) => {
  console.log(`[fsClient] Created in ${basePath}`);
  fs.mkdirSync(basePath, { recursive: true });
  const writesDir = path.join(basePath, WRITES_DIR);

  const wrap = (fn: FSWraps | ReturnType<typeof atomicWriter> | typeof readdir) => async (filePath: string, ...args: any[]) => {
    const modifiedPath = path.join(basePath, path.normalize(filePath));
    const relative = path.relative(basePath, modifiedPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Refusing ${filePath}: outside ${basePath}`);
    }
    // @ts-expect-error -- TSCONVERSION
    return fn(modifiedPath, ...args);
  };

  const readdir = async (dirPath: string, ...args: any[]) => {
    const entries: (string | fs.Dirent)[] = await fs.promises.readdir(dirPath, ...args);
    return path.resolve(dirPath) === path.resolve(basePath)
      ? entries.filter(entry => (typeof entry === 'string' ? entry : entry.name) !== WRITES_DIR)
      : entries;
  };

  return {
    promises: {
      readFile: wrap(fs.promises.readFile),
      writeFile: wrap(atomicWriter(writesDir)),
      unlink: wrap(fs.promises.unlink),
      readdir: wrap(readdir),
      mkdir: wrap(fs.promises.mkdir),
      rmdir: wrap(fs.promises.rmdir),
      stat: wrap(fs.promises.stat),
      lstat: wrap(fs.promises.lstat),
      readlink: wrap(fs.promises.readlink),
      symlink: wrap(fs.promises.symlink),
    },
  };
};
