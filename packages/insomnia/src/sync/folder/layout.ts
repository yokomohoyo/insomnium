// A collection as readable files in a folder of your own (main/folder-sync.ts
// keeps the two in step): a directory per folder, a YAML file per request,
// named after them, and the environments in environments/. A file keeps its
// document's _id, so a rename or a move between folders is the same request;
// where a file sits says which folder it's in, and `order` its place there.
// Timestamps are left out, so a diff shows only what was changed.
//
//   insomnium.yaml              the collection
//   environments/_base.yaml     its base environment
//   environments/Staging.yaml   a sub environment
//   Orders/_folder.yaml         a folder
//   Orders/Create order.yaml    a request, with its examples
import YAML from 'yaml';

export const COLLECTION_FILE = 'insomnium.yaml';
export const FOLDER_FILE = '_folder.yaml';
export const ENVIRONMENTS_DIR = 'environments';
export const BASE_ENVIRONMENT_FILE = '_base.yaml';

export const REQUEST_TYPES = ['Request', 'GrpcRequest', 'WebSocketRequest', 'McpRequest'];
const EXAMPLE_TYPE = 'ResponseExample';

export interface SyncDoc {
  _id: string;
  type: string;
  parentId: string | null;
  name?: string;
  metaSortKey?: number;
  isPrivate?: boolean;
  [key: string]: any;
}

// left out of the files: kept by the app, or derived from where a file is
const LEFT_OUT = new Set(['_id', 'type', 'parentId', 'modified', 'created', 'metaSortKey']);

const fileName = (name: string | undefined) => {
  const cleaned = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80);
  return cleaned || 'untitled';
};

// _id, type, name, then the rest in order, so files don't shuffle
const readable = (doc: SyncDoc, extra: Record<string, unknown> = {}) => {
  const out: Record<string, unknown> = { _id: doc._id, type: doc.type, name: doc.name ?? '' };
  for (const key of Object.keys(doc).filter(key => !LEFT_OUT.has(key) && key !== 'name').sort()) {
    out[key] = doc[key];
  }
  if (typeof doc.metaSortKey === 'number') {
    out.order = doc.metaSortKey;
  }
  return { ...out, ...extra };
};

const yaml = (value: unknown) => YAML.stringify(value, { lineWidth: 0 });

const byOrder = (a: SyncDoc, b: SyncDoc) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0) || a._id.localeCompare(b._id);

// a name not already taken in a directory: "Name", then "Name (2)"
const unique = (taken: Set<string>, base: string, suffix: string) => {
  for (let count = 1; ; count++) {
    const candidate = `${count === 1 ? base : `${base} (${count})`}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
};

// The files for a collection's documents (a workspace and what's under it).
// Private environments and requests stay out, as they do from Git Sync.
export function collectionFiles(docs: SyncDoc[]): Map<string, string> {
  const files = new Map<string, string>();
  const workspace = docs.find(doc => doc.type === 'Workspace');
  if (!workspace) {
    return files;
  }
  files.set(COLLECTION_FILE, yaml(readable(workspace)));

  const children = new Map<string | null, SyncDoc[]>();
  for (const doc of docs) {
    if (doc.isPrivate) {
      continue;
    }
    children.set(doc.parentId, [...(children.get(doc.parentId) || []), doc]);
  }

  const base = (children.get(workspace._id) || []).find(doc => doc.type === 'Environment');
  if (base) {
    files.set(`${ENVIRONMENTS_DIR}/${BASE_ENVIRONMENT_FILE}`, yaml(readable(base)));
    const taken = new Set([BASE_ENVIRONMENT_FILE.toLowerCase()]);
    for (const sub of (children.get(base._id) || []).filter(doc => doc.type === 'Environment').sort(byOrder)) {
      files.set(`${ENVIRONMENTS_DIR}/${unique(taken, fileName(sub.name), '.yaml')}`, yaml(readable(sub)));
    }
  }

  const walk = (parentId: string, dir: string) => {
    const taken = new Set([COLLECTION_FILE, FOLDER_FILE, ENVIRONMENTS_DIR].map(name => name.toLowerCase()));
    for (const doc of (children.get(parentId) || []).sort(byOrder)) {
      if (doc.type === 'RequestGroup') {
        const name = unique(taken, fileName(doc.name), '');
        files.set(`${dir}${name}/${FOLDER_FILE}`, yaml(readable(doc)));
        walk(doc._id, `${dir}${name}/`);
      } else if (REQUEST_TYPES.includes(doc.type)) {
        const examples = (children.get(doc._id) || []).filter(child => child.type === EXAMPLE_TYPE).sort(byOrder).map(example => readable(example));
        files.set(`${dir}${unique(taken, fileName(doc.name), '.yaml')}`, yaml(readable(doc, examples.length ? { examples } : {})));
      }
    }
  };
  walk(workspace._id, '');
  return files;
}

export interface FolderDocs {
  docs: SyncDoc[];
  // files that couldn't be read
  problems: string[];
}

const dirOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

// The documents a folder's files hold, with where they sit as their parent.
// A file is the collection's only when it says its type (as the app writes
// it), so other YAML in the folder is left alone. One without an _id is a new
// document (newId gives it one); one that isn't YAML is listed in problems.
export function folderDocs(files: Map<string, string>, newId: (type: string) => string): FolderDocs {
  const docs: SyncDoc[] = [];
  const problems: string[] = [];
  const parse = (path: string) => {
    try {
      const value = YAML.parse(files.get(path) || '');
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('not a YAML mapping');
      }
      return value as Record<string, any>;
    } catch (err) {
      problems.push(`${path}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  };
  const asDoc = (value: Record<string, any>, type: string, parentId: string | null): SyncDoc => {
    const { _id, type: _type, order, examples: _examples, ...fields } = value;
    return {
      ...fields,
      _id: typeof _id === 'string' && _id ? _id : newId(type),
      type,
      parentId,
      ...(typeof order === 'number' ? { metaSortKey: order } : {}),
    };
  };

  const collection = files.has(COLLECTION_FILE) ? parse(COLLECTION_FILE) : null;
  if (!collection || typeof collection._id !== 'string') {
    problems.push(`${COLLECTION_FILE}: missing, or without the collection's _id`);
    return { docs, problems };
  }
  const workspace = asDoc(collection, 'Workspace', null);
  docs.push(workspace);

  const baseValue = files.has(`${ENVIRONMENTS_DIR}/${BASE_ENVIRONMENT_FILE}`) ? parse(`${ENVIRONMENTS_DIR}/${BASE_ENVIRONMENT_FILE}`) : null;
  const base = baseValue ? asDoc(baseValue, 'Environment', workspace._id) : null;
  if (base) {
    docs.push(base);
  }

  // each directory's folder, from its _folder.yaml, parents first
  const folderIds = new Map<string, string>([['', workspace._id]]);
  const paths = [...files.keys()].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  for (const path of paths.filter(path => path.endsWith(`/${FOLDER_FILE}`))) {
    const dir = dirOf(path);
    const parentId = folderIds.get(dirOf(dir));
    const value = parentId ? parse(path) : null;
    if (!value || !parentId || value.type !== 'RequestGroup') {
      continue;
    }
    const folder = asDoc(value, 'RequestGroup', parentId);
    folderIds.set(dir, folder._id);
    docs.push(folder);
  }

  for (const path of paths) {
    if (!path.endsWith('.yaml') || path === COLLECTION_FILE || path.endsWith(`/${FOLDER_FILE}`)) {
      continue;
    }
    if (path.startsWith(`${ENVIRONMENTS_DIR}/`)) {
      if (path !== `${ENVIRONMENTS_DIR}/${BASE_ENVIRONMENT_FILE}` && base && dirOf(path) === ENVIRONMENTS_DIR) {
        const value = parse(path);
        if (value?.type === 'Environment') {
          docs.push(asDoc(value, 'Environment', base._id));
        }
      }
      continue;
    }
    const parentId = folderIds.get(dirOf(path));
    const value = parentId ? parse(path) : null;
    if (!value || !parentId || !REQUEST_TYPES.includes(value.type)) {
      continue;
    }
    const request = asDoc(value, value.type, parentId);
    docs.push(request);
    for (const example of Array.isArray(value.examples) ? value.examples : []) {
      if (example && typeof example === 'object') {
        docs.push(asDoc(example, EXAMPLE_TYPE, request._id));
      }
    }
  }
  return { docs, problems };
}

// the fields a file holds for a document, to compare a file's with the app's
export const comparable = (doc: SyncDoc) => JSON.stringify(readable(doc));
