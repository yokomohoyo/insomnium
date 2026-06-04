import fs from "fs";
import path from "path";

import * as protoLoader from "@grpc/proto-loader";

import * as models from "../../models";
import { database as db } from "../../common/database";
import { ProtoDirectory } from "../../models/proto-directory";
import { ProtoFile } from "../../models/proto-file";
import { writeProtoFile } from "./write-proto-file";
import { Workspace } from "../../models/workspace";
import type { FetchedProto } from "./proto-fetcher";

export type ProtoLoadResult = { success: true; loaded: ProtoFile[]; errors: string[] } | { success: false; errors: string[] };

export async function addFileFromPath(filePath: string, parent: ProtoDirectory | Workspace): Promise<ProtoLoadResult> {
  // First validate the proto file
  const validationResult = await validateProtoFile(filePath, parent);

  if (validationResult.success) {
    // If proto file is valid, add it
    const contents = await fs.promises.readFile(filePath, "utf-8");
    const newFile = await models.protoFile.create({
      name: path.basename(filePath),
      parentId: parent._id,
      protoText: contents,
    });

    return { success: true, loaded: [newFile], errors: [] };
  } else {
    return { success: false, errors: validationResult.errors };
  }
}

export async function updateFileFromPath(protoFile: ProtoFile, filePath: string): Promise<ProtoLoadResult> {
  // First validate the proto file
  const parent = (await models.protoDirectory.getById(protoFile.parentId)) ?? (await models.workspace.getById(protoFile.parentId));
  const validationResult = await validateProtoFile(filePath, parent!);

  if (validationResult.success) {
    // If file is valid, update it
    const contents = await fs.promises.readFile(filePath, "utf-8");
    const contentsChanged = contents !== protoFile.protoText;
    const updatedFile = await models.protoFile.update(protoFile, {
      name: path.basename(filePath),
      protoText: contents,
    });
    // force update the proto file if the content changed
    writeProtoFile(updatedFile, contentsChanged);

    return { success: true, loaded: [updatedFile], errors: [] };
  } else {
    return { success: false, errors: validationResult.errors };
  }
}

export async function addDirectoryFromPath(directoryPath: string, parent: ProtoDirectory | Workspace): Promise<ProtoLoadResult> {
  const entries = await fs.promises.readdir(directoryPath, {
    withFileTypes: true,
  });
  if (entries.length === 0) return { success: true, loaded: [], errors: [] };

  const loaded: ProtoFile[] = [];
  const errors: string[] = [];

  // Make temporary parent id without making the model yet
  const newDirectory = await models.protoDirectory.create({
    name: path.basename(directoryPath),
    parentId: parent._id,
  });

  for (const e of entries) {
    const entryPath = path.join(directoryPath, e.name);
    if (e.isDirectory()) {
      const nestedResult = await addDirectoryFromPath(entryPath, newDirectory);
      if (nestedResult.success) loaded.push(...nestedResult.loaded);
      errors.push(...nestedResult.errors);
    } else {
      if (!e.name.endsWith(".proto")) {
        continue; // Not a protobuf file, skip
      }

      const addResult = await addFileFromPath(entryPath, newDirectory);
      if (addResult.success) loaded.push(...addResult.loaded);
      errors.push(...addResult.errors);
    }
  }

  if (loaded.length === 0) {
    // If no files were created, remove the created directory again
    models.protoDirectory.remove(newDirectory);
  }

  return { success: true, loaded, errors };
}

export async function updateDirectoryFromPath(directoryPath: string, protoDir: ProtoDirectory): Promise<ProtoLoadResult> {
  const entries = await fs.promises.readdir(directoryPath, {
    withFileTypes: true,
  });
  if (entries.length === 0) return { success: true, loaded: [], errors: [] };

  const loaded: ProtoFile[] = [];
  const errors: string[] = [];

  const existingChildren = await findDirectoryChildren(protoDir);
  for (const e of entries) {
    const entryPath = path.join(directoryPath, e.name);
    if (e.isDirectory()) {
      // If the child is a known directory recurse the update into it, otherwise add it to db
      const existingDirectory = existingChildren.find(c => models.protoDirectory.isProtoDirectory(c) && c.name === e.name);
      if (existingDirectory) {
        // Directory already known, udpate it
        const updateResult = await updateDirectoryFromPath(entryPath, existingDirectory);
        if (updateResult.success) loaded.push(...updateResult.loaded);
        errors.push(...updateResult.errors);
      } else {
        // Directory unknown, add it
        const addResult = await addDirectoryFromPath(entryPath, protoDir);
        if (addResult.success) loaded.push(...addResult.loaded);
        errors.push(...addResult.errors);
      }
    } else {
      // If the child is a file, update if known, otherwise add it
      const existingFile = existingChildren.find((c): c is ProtoFile => models.protoFile.isProtoFile(c) && c.name === e.name);
      if (existingFile) {
        // File already known, update it
        const updateResult = await updateFileFromPath(existingFile, entryPath);
        if (updateResult.success) loaded.push(...updateResult.loaded);
        errors.push(...updateResult.errors);
      } else {
        // File is new, add it
        const addResult = await addFileFromPath(entryPath, protoDir);
        if (addResult.success) loaded.push(...addResult.loaded);
        errors.push(...addResult.errors);
      }
    }
  }

  return { success: true, loaded, errors };
}

// Persist an in-memory bundle (from a URL/BSR fetch) as ProtoFile / ProtoDirectory.
export async function addProtoFromFetched(fetched: FetchedProto, parent: ProtoDirectory | Workspace): Promise<ProtoLoadResult> {
  const loaded: ProtoFile[] = [];
  const errors: string[] = [];

  if (!fetched.isDirectory && fetched.files.length === 1) {
    const f = fetched.files[0];
    const newFile = await models.protoFile.create({
      name: sanitizeFileName(pathBasename(f.path)),
      parentId: parent._id,
      protoText: f.protoText,
    });
    return { success: true, loaded: [newFile], errors };
  }

  const rootDir = await models.protoDirectory.create({
    name: sanitizeDirName(fetched.rootName),
    parentId: parent._id,
  });
  const dirCache = new Map<string, ProtoDirectory>([['', rootDir]]);

  const ensureDir = async (relDir: string): Promise<ProtoDirectory> => {
    if (dirCache.has(relDir)) return dirCache.get(relDir)!;
    const parts = relDir.split('/').filter(Boolean);
    let currentKey = '';
    let currentDir: ProtoDirectory = rootDir;
    for (const part of parts) {
      const nextKey = currentKey ? `${currentKey}/${part}` : part;
      let next = dirCache.get(nextKey);
      if (!next) {
        next = await models.protoDirectory.create({
          name: sanitizeDirName(part),
          parentId: currentDir._id,
        });
        dirCache.set(nextKey, next);
      }
      currentKey = nextKey;
      currentDir = next;
    }
    return currentDir;
  };

  for (const f of fetched.files) {
    try {
      const rel = f.path.replace(/^\/+/, '');
      const dirPart = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const filePart = rel.slice(rel.lastIndexOf('/') + 1);
      const dir = dirPart ? await ensureDir(dirPart) : rootDir;
      const created = await models.protoFile.create({
        name: sanitizeFileName(filePart),
        parentId: dir._id,
        protoText: f.protoText,
      });
      loaded.push(created);
    } catch (err) {
      errors.push(`${f.path}: ${(err as Error).message}`);
    }
  }

  if (loaded.length === 0) {
    await models.protoDirectory.remove(rootDir);
  }
  return { success: true, loaded, errors };
}

function pathBasename(p: string): string {
  return p.split('/').pop() ?? p;
}

function sanitizeDirName(name: string): string {
  const cleaned = pathBasename(name).replace(/[^a-z0-9._-]/gi, '_');
  return cleaned || 'proto';
}

function sanitizeFileName(name: string): string {
  const cleaned = pathBasename(name).replace(/[^a-z0-9._-]/gi, '_');
  return cleaned.endsWith('.proto') ? cleaned : `${cleaned}.proto`;
}

async function findDirectoryChildren(protoDir: ProtoDirectory): Promise<(ProtoFile | ProtoDirectory)[]> {
  const descendants = await db.withDescendants(protoDir);
  return descendants.filter(d => (models.protoFile.isProtoFile(d) || models.protoDirectory.isProtoDirectory(d)) && d._id !== protoDir._id);
}

async function findAncestorDirectories(filePath: string, context: ProtoDirectory | Workspace): Promise<string[]> {
  if (models.workspace.isWorkspace(context)) {
    return [path.dirname(filePath)];
  } else {
    /* Traverse up the file tree to gather all _real_ ancestor directories */
    let parent = await models.protoDirectory.getById(context._id);
    let basePath = filePath;
    const result = [];
    while (parent !== null) {
      basePath = path.dirname(basePath);
      result.push(basePath);
      parent = await models.protoDirectory.getById(parent.parentId);
    }
    return result;
  }
}

// Common buf cache locations across platforms. Best-effort: missing dirs are
// fine - proto-loader silently ignores them.
function bufCacheCandidates(): string[] {
  const home = process.env.HOME || '';
  if (!home) return [];
  return [
    // buf v2 (current default on most installs)
    path.join(home, 'Library/Caches/buf/v2/module/cache'),
    path.join(home, '.cache/buf/v2/module/cache'),
    // buf v3 (newer)
    path.join(home, 'Library/Caches/buf/v3/modules/data'),
    path.join(home, '.cache/buf/v3/modules/data'),
  ];
}

// Build the include path: the file's ancestor chain plus the buf cache.
// Buf-style protos often `import "google/api/annotations.proto"` etc which
// aren't physically present in the user's repo; they live in the buf cache.
async function buildIncludeDirs(filePath: string, parent: ProtoDirectory | Workspace): Promise<string[]> {
  const ancestors = await findAncestorDirectories(filePath, parent);
  const bufDirs = bufCacheCandidates().filter(p => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
  return [...ancestors, ...bufDirs];
}

async function validateProtoFile(filePath: string, parent: ProtoDirectory | Workspace): Promise<ProtoLoadResult> {
  const includeDirs = await buildIncludeDirs(filePath, parent);
  try {
    await protoLoader.load(filePath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: includeDirs,
    });
    return { success: true, loaded: [], errors: [] };
  } catch (e: any) {
    return { success: false, errors: [formatProtoLoadError(filePath, e)] };
  }
}

// Friendlier error: if it looks like a missing import, point the user at fixes.
function formatProtoLoadError(filePath: string, err: any): string {
  const msg = String(err?.message || err);
  // protobufjs raises "illegal token '<'" when an import path resolves to a
  // non-proto file (e.g. an HTML 404 page) - which usually means the import
  // wasn't found on the include path and a stub got matched instead.
  if (/illegal token '<'/.test(msg)) {
    return `${filePath}: missing transitive proto import (${msg}). ` +
      `If this is a buf project, run \`buf export . -o /tmp/flat\` and import /tmp/flat, ` +
      `or use the "Import from URL" button with your BSR module URL.`;
  }
  return `${filePath}: ${msg}`;
}
