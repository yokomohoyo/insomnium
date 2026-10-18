// What changed in a synced document between its last commit and now, by field:
// the files are named by id, so a raw YAML diff says little. Lists of named
// entries (headers, parameters, a body's form fields) say which entries were
// added, removed or changed. Timestamps and sort order are noise, counted but
// not listed, so a commit that only reorders things can say so.
import YAML from 'yaml';

export interface FieldChange {
  field: string;
  before?: string;
  after?: string;
  // for a list of named entries, what happened to them
  detail?: string;
}

export interface DocDiff {
  changes: FieldChange[];
  // timestamps or sort order changed too
  noise: boolean;
}

const NOISE = new Set(['modified', 'created', 'metaSortKey']);
const IDENTITY = new Set(['_id', 'type']);
const MAX_LENGTH = 200;

const parse = (text: string | null) => {
  if (!text) {
    return null;
  }
  try {
    const doc = YAML.parse(text);
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const shown = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
};

const isNamedList = (value: unknown): value is { name: string }[] =>
  Array.isArray(value) && value.length > 0 && value.every(entry => entry && typeof entry === 'object' && typeof entry.name === 'string');

const listDetail = (before: { name: string }[], after: { name: string }[]) => {
  const byName = (list: { name: string }[]) => new Map(list.map(entry => [entry.name, JSON.stringify(entry)]));
  const was = byName(before);
  const now = byName(after);
  const added = [...now.keys()].filter(name => !was.has(name));
  const removed = [...was.keys()].filter(name => !now.has(name));
  const changed = [...now.keys()].filter(name => was.has(name) && was.get(name) !== now.get(name));
  const parts = [
    added.length ? `added ${added.join(', ')}` : '',
    removed.length ? `removed ${removed.join(', ')}` : '',
    changed.length ? `changed ${changed.join(', ')}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : 'reordered';
};

export function docDiff(beforeText: string | null, afterText: string | null): DocDiff {
  const before = parse(beforeText);
  const after = parse(afterText);
  if (!before || !after) {
    // added or deleted: the row says which
    return { changes: [], noise: false };
  }

  const changes: FieldChange[] = [];
  let noise = false;
  const fields = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  for (const field of fields) {
    if (IDENTITY.has(field) || JSON.stringify(before[field]) === JSON.stringify(after[field])) {
      continue;
    }
    if (NOISE.has(field)) {
      noise = true;
      continue;
    }
    const was = before[field];
    const now = after[field];
    if ((isNamedList(was) || Array.isArray(was) && !was.length) && (isNamedList(now) || Array.isArray(now) && !now.length)) {
      changes.push({ field, detail: listDetail(was as { name: string }[], now as { name: string }[]) });
    } else {
      changes.push({ field, before: shown(was), after: shown(now) });
    }
  }
  return { changes, noise };
}
