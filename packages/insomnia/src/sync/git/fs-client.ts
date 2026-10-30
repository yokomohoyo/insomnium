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

let temps = 0;

// isomorphic-git rewrites HEAD, refs and the index in place, and a plain write
// empties the file first: a read meanwhile (the branch shown, the status) finds
// no HEAD. Written in a folder beside the store (git lists refs/heads and walks
// the work tree, so not in it) and renamed over it, a file is either old or new.
const atomicWriter = (tempDir: string) => async (filePath: string, ...args: any[]) => {
  const temp = path.join(tempDir, `${process.pid}.${++temps}`);
  // @ts-expect-error -- TSCONVERSION
  await fs.promises.writeFile(temp, ...args);
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
  const tempDir = `${path.resolve(basePath)}.tmp`;
  fs.mkdirSync(tempDir, { recursive: true });

  const wrap = (fn: FSWraps | ReturnType<typeof atomicWriter>) => async (filePath: string, ...args: any[]) => {
    const modifiedPath = path.join(basePath, path.normalize(filePath));
    const relative = path.relative(basePath, modifiedPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Refusing ${filePath}: outside ${basePath}`);
    }
    // @ts-expect-error -- TSCONVERSION
    return fn(modifiedPath, ...args);
  };

  return {
    promises: {
      readFile: wrap(fs.promises.readFile),
      writeFile: wrap(atomicWriter(tempDir)),
      unlink: wrap(fs.promises.unlink),
      readdir: wrap(fs.promises.readdir),
      mkdir: wrap(fs.promises.mkdir),
      rmdir: wrap(fs.promises.rmdir),
      stat: wrap(fs.promises.stat),
      lstat: wrap(fs.promises.lstat),
      readlink: wrap(fs.promises.readlink),
      symlink: wrap(fs.promises.symlink),
    },
  };
};
