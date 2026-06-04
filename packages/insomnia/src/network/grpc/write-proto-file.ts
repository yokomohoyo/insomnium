import fs from 'fs';
import os from 'os';
import path from 'path';

import { database as db } from '../../common/database';
import type { BaseModel } from '../../models';
import * as models from '../../models';
import { isProtoDirectory, ProtoDirectory } from '../../models/proto-directory';
import { isProtoFile, ProtoFile } from '../../models/proto-file';
import { isWorkspace } from '../../models/workspace';

interface WriteResult {
  filePath: string;
  dirs: string[];
}

// Reject symlinks at the predictable tmp path (local-attacker pre-create).
const ensureGrpcRootDir = (): string => {
  const rootDir = path.join(os.tmpdir(), 'insomnia-grpc');
  try {
    fs.mkdirSync(rootDir, { mode: 0o700, recursive: true });
  } catch (err: any) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
  const st = fs.lstatSync(rootDir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`insomnia-grpc tmp path is not a regular directory: ${rootDir}`);
  }
  return rootDir;
};

// A ProtoDirectory / ProtoFile `name` becomes a path segment on disk via
// path.join. A malicious value (`../../etc/passwd`, absolute path, embedded
// slash) lets an attacker who can populate the model - e.g. by getting the
// user to import a crafted workspace JSON - write arbitrary content anywhere
// the user can write. Require each name to be a single filesystem-safe
// component.
export const assertSafeNameSegment = (name: string, kind: 'proto file' | 'proto directory'): void => {
  if (typeof name !== 'string'
    || name.length === 0
    || name === '.'
    || name === '..'
    || name.includes('/')
    || name.includes('\\')
    || name.includes('\0')
    || path.isAbsolute(name)
    || path.basename(name) !== name) {
    throw new Error(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  }
};

// Defense in depth: even after segment validation, confirm path.join did not
// produce a result outside the intended parent. Throws on any escape.
export const assertWithinRoot = (parent: string, child: string): void => {
  const rel = path.relative(parent, child);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes parent directory: ${JSON.stringify(child)}`);
  }
};

const recursiveWriteProtoDirectory = async (
  dir: ProtoDirectory,
  descendants: BaseModel[],
  currentDirPath: string,
  forceWrite: boolean,
): Promise<string[]> => {
  // Increment folder path
  assertSafeNameSegment(dir.name, 'proto directory');
  const dirPath = path.join(currentDirPath, dir.name);
  assertWithinRoot(currentDirPath, dirPath);
  fs.mkdirSync(dirPath, { recursive: true });
  // Get and write proto files
  const files = descendants.filter(isProtoFile).filter(f => f.parentId === dir._id);
  await Promise.all(files.map(protoFile => {
    assertSafeNameSegment(protoFile.name, 'proto file');
    const fullPath = path.join(dirPath, protoFile.name);
    assertWithinRoot(dirPath, fullPath);
    if (!forceWrite && fs.existsSync(fullPath)) {
      return;
    }
    fs.promises.writeFile(fullPath, protoFile.protoText);
  }));
  // Get and write subdirectories
  const createdDirs = await Promise.all(
    descendants.filter(f => isProtoDirectory(f) && f.parentId === dir._id).map(f => recursiveWriteProtoDirectory(f, descendants, dirPath, forceWrite)),
  );
  return [dirPath, ...createdDirs.flat()];
};

export const writeProtoFile = async (protoFile: ProtoFile, forceWrite = false): Promise<WriteResult> => {
  // Find all ancestors
  const ancestors = await db.withAncestors(protoFile, [
    models.protoDirectory.type,
    models.workspace.type,
  ]);
  const ancestorDirectories = ancestors.filter(isProtoDirectory);

  // Is this file part of a directory?
  if (ancestorDirectories.length) {
    // Write proto file tree from root directory
    // Find the root ancestor directory
    const rootAncestorProtoDirectory = ancestors.find(
      // @ts-expect-error -- TSCONVERSION ancestor workspace can be undefined
      c => isProtoDirectory(c) && c.parentId === ancestors.find(isWorkspace)._id,
    );
    if (!ancestors.find(isWorkspace) || !rootAncestorProtoDirectory) {
      // should never happen
      return {
        filePath: path.join(...ancestorDirectories
          .map(f => f.name)
          .reverse()
          .slice(1), protoFile.name),
        dirs: [],
      };
    }
    // Find all descendants of the root ancestor directory
    const descendants = await db.withDescendants(rootAncestorProtoDirectory);
    const rootDir = ensureGrpcRootDir();
    const treeRootDirs = await recursiveWriteProtoDirectory(
      rootAncestorProtoDirectory,
      descendants,
      path.join(
        rootDir,
        `${rootAncestorProtoDirectory._id}.${rootAncestorProtoDirectory.modified}`,
      ),
      forceWrite
    );
    return {
      filePath: path.join(...ancestorDirectories
        .map(f => f.name)
        .reverse()
        .slice(1), protoFile.name),
      dirs: treeRootDirs,
    };
  } else {
    // Write single file
    const rootDir = ensureGrpcRootDir();

    const filePath = `${protoFile._id}.${protoFile.modified}.proto`;
    const result = {
      filePath,
      dirs: [rootDir],
    };
    // Check if file already exists
    const fullPath = path.join(rootDir, filePath);
    if (!forceWrite && fs.existsSync(fullPath)) {
      return result;
    }
    // Write file
    await fs.promises.writeFile(fullPath, protoFile.protoText);
    return result;
  }
};
