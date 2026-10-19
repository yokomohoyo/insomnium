// Commits made from files rather than from a work tree: what a stash and a
// rebase write. isomorphic-git has neither, and its walk of the work tree can't
// see the synced documents (NeDBClient keeps them in the database).
import * as git from 'isomorphic-git';

import { describeDoc, type DocConflict, isSyncedDoc, type MergeChoice, mergeDoc } from './merge-docs';
import { mergeLines } from './line-merge';

interface Opts {
  fs: git.CallbackFsClient | git.PromiseFsClient;
  dir: string;
  gitdir?: string;
}

export interface TreeFile {
  oid: string;
  mode: string;
}

// every file in a commit, by path
export async function filesAt(opts: Opts, ref: string) {
  const files = new Map<string, TreeFile>();
  await git.walk({
    ...opts,
    trees: [git.TREE({ ref })],
    map: async (filepath, [entry]) => {
      if (entry && filepath !== '.' && (await entry.type()) === 'blob') {
        files.set(filepath, { oid: await entry.oid(), mode: (await entry.mode()).toString(8) });
      }
      return true;
    },
  });
  return files;
}

type Folder = Map<string, TreeFile | Folder>;

// the tree, with its subtrees, that holds these files
export async function writeFiles(opts: Opts, files: Map<string, TreeFile>) {
  const root: Folder = new Map();
  for (const [filepath, file] of files) {
    const parts = filepath.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.get(part);
      if (!(next instanceof Map)) {
        next = new Map();
        folder.set(part, next);
      }
      folder = next;
    }
    folder.set(parts[parts.length - 1], file);
  }
  const write = async (folder: Folder): Promise<string> => {
    const tree: git.TreeEntry[] = [];
    for (const [name, entry] of folder) {
      tree.push(entry instanceof Map
        ? { mode: '040000', path: name, oid: await write(entry), type: 'tree' }
        : { mode: entry.mode, path: name, oid: entry.oid, type: 'blob' });
    }
    return git.writeTree({ ...opts, tree });
  };
  return write(root);
}

export const readText = async (opts: Opts, oid: string | undefined) =>
  oid ? Buffer.from((await git.readBlob({ ...opts, oid })).blob).toString() : null;

/**
 * A file merged three ways, as a merge does: a synced document by its fields
 * (merge-docs.ts), any other file by its lines. null is a file that isn't
 * there (never added, or deleted). A choice settles a clash; without one,
 * the clash is described.
 */
export function mergeFile(file: string, base: string | null, ours: string | null, theirs: string | null, choice?: MergeChoice):
  { merged: string | null } | { conflict: DocConflict } {
  if (ours === theirs || base === theirs) {
    return { merged: ours };
  }
  if (base === ours) {
    return { merged: theirs };
  }
  if (choice) {
    // a deletion on one side either stands or doesn't, as chosen
    const chosen = choice === 'ours' ? ours : theirs;
    if (chosen === null || ours === null || theirs === null) {
      return { merged: chosen };
    }
  }
  if (ours === null || theirs === null) {
    return {
      conflict: {
        file,
        ...describeDoc(...[ours, theirs, base].filter((text): text is string => text !== null)),
        fields: [{ field: '(file)', ours: ours === null ? '(deleted)' : '(changed)', theirs: theirs === null ? '(deleted)' : '(changed)' }],
      },
    };
  }
  const name = file.split('/').pop() || file;
  if (isSyncedDoc(name, ours, theirs)) {
    const { merged, conflicts } = mergeDoc(base ?? '', ours, theirs, choice);
    return merged === undefined ? { conflict: { file, ...describeDoc(ours, theirs), fields: conflicts } } : { merged };
  }
  const lines = mergeLines(base ?? '', ours, theirs);
  if (lines.cleanMerge) {
    return { merged: lines.mergedText };
  }
  if (choice) {
    return { merged: choice === 'ours' ? ours : theirs };
  }
  return { conflict: { file, name: file, type: 'File', fields: [{ field: '(file)' }] } };
}
