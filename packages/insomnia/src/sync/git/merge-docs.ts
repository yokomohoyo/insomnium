// A three-way merge of a synced document, field by field, for git merges and
// pulls (isomorphic-git's mergeDriver). Changes to different fields on the two
// sides both apply, where a merge of the YAML's lines could clash over lines
// that are only near each other. When both sides changed a field differently,
// a choice for the document ('ours' or 'theirs') decides it; without one, the
// conflicting fields are reported, to be chosen in the app.
import YAML from 'yaml';

import { mergeLines } from './line-merge';

export type MergeChoice = 'ours' | 'theirs';

export interface FieldConflict {
  field: string;
  ours?: string;
  theirs?: string;
}

export interface DocConflict {
  // the document's file name, which is its id: what isomorphic-git gives a merge driver
  file: string;
  name: string;
  type: string;
  fields: FieldConflict[];
}

// timestamps and order: the later, and ours, without asking
const NOISE = new Set(['modified', 'metaSortKey', 'created']);
const MAX_LENGTH = 200;

const parse = (text: string) => {
  try {
    const doc = YAML.parse(text);
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const shown = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
};

export function mergeDoc(base: string, ours: string, theirs: string, choice?: MergeChoice): { merged?: string; conflicts: FieldConflict[] } {
  const [b, o, t] = [parse(base), parse(ours), parse(theirs)];
  if (!o || !t) {
    // not a document: the whole file, as chosen
    if (choice) {
      return { merged: choice === 'ours' ? ours : theirs, conflicts: [] };
    }
    return { conflicts: [{ field: '(file)' }] };
  }

  const conflicts: FieldConflict[] = [];
  const merged = mergeFields(b || {}, o, t, choice, conflicts);
  return conflicts.length ? { conflicts } : { merged: YAML.stringify(merged), conflicts };
}

function mergeFields(before: Record<string, unknown>, o: Record<string, unknown>, t: Record<string, unknown>, choice: MergeChoice | undefined, conflicts: FieldConflict[], prefix = '') {
  const merged: Record<string, unknown> = {};
  for (const field of [...new Set([...Object.keys(o), ...Object.keys(t), ...Object.keys(before)])]) {
    const [was, mine, yours] = [before[field], o[field], t[field]];
    let value: unknown;
    if (same(mine, yours) || same(yours, was)) {
      value = mine;
    } else if (same(mine, was)) {
      value = yours;
    } else if (!prefix && field === 'modified') {
      value = Math.max(Number(mine) || 0, Number(yours) || 0);
    } else if (!prefix && NOISE.has(field)) {
      value = mine;
    } else if (isRecord(mine) && isRecord(yours) && (isRecord(was) || was === undefined)) {
      // an object (a body, an authentication): by its own fields
      value = mergeFields(was || {}, mine, yours, choice, conflicts, `${prefix}${field}.`);
    } else if (typeof mine === 'string' && typeof yours === 'string' && (typeof was === 'string' || was === undefined) && (mine.includes('\n') || yours.includes('\n')) && mergeLines(String(was ?? ''), mine, yours).cleanMerge) {
      // a long text (a spec, a body, a script) changed in different places
      value = mergeLines(String(was ?? ''), mine, yours).mergedText;
    } else if (choice) {
      value = choice === 'ours' ? mine : yours;
    } else {
      conflicts.push({ field: `${prefix}${field}`, ours: shown(mine), theirs: shown(yours) });
      continue;
    }
    if (value !== undefined) {
      merged[field] = value;
    }
  }
  return merged;
}

// Is a file one of the synced documents? isomorphic-git gives a merge driver
// only its name, and a document's file is named for its _id
export function isSyncedDoc(file: string, ...texts: string[]) {
  const id = file.replace(/\.yml$/, '');
  return file.endsWith('.yml') && texts.some(text => {
    const doc = parse(text);
    return !!doc && doc._id === id && typeof doc.type === 'string';
  });
}

// a document's name and type, for listing a conflict
export function describeDoc(...texts: string[]) {
  for (const text of texts) {
    const doc = parse(text);
    if (doc) {
      return { name: String(doc.name || doc.fileName || doc._id || ''), type: String(doc.type || '') };
    }
  }
  return { name: '', type: '' };
}
