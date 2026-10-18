// Whether two versions of a repository file hold the same thing. A synced
// document is compared as the database stores it (its model's defaults filled
// in, migrated, unknown fields pruned), by its fields, so YAML another client
// wrote, or a commit from before a field existed, doesn't count as a change.
// Its modified and created times don't either, and nor does its sort order
// when one side doesn't set it: the defaults for those come from the clock.
import YAML from 'yaml';

import * as models from '../../models';
import { resetKeys } from '../ignore-keys';

// JSON with every object's keys in order, so the same fields compare equal
const canonical = (value: unknown) => JSON.stringify(value, (_key, inner) =>
  inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : inner);

const asStored = async (type: string, content: Uint8Array) => {
  const parsed = YAML.parse(Buffer.from(content).toString());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const doc: Record<string, unknown> = { ...await models.initModel(type, parsed) };
  resetKeys(doc as unknown as models.BaseModel);
  delete doc.modified;
  delete doc.created;
  return { doc, given: Object.keys(parsed) };
};

// a and b are the file's contents, or null where there's no such file
export async function sameFile(filepath: string, a: Uint8Array | null, b: Uint8Array | null, dataDirName: string) {
  if (!a || !b) {
    return a === b;
  }
  if (Buffer.from(a).equals(Buffer.from(b))) {
    return true;
  }
  const [root, type, fileName, ...rest] = filepath.split('/');
  if (root !== dataDirName || !fileName || rest.length || !models.getModel(type)) {
    return false;
  }
  try {
    const [x, y] = [await asStored(type, a), await asStored(type, b)];
    if (!x || !y) {
      return false;
    }
    if (!x.given.includes('metaSortKey') || !y.given.includes('metaSortKey')) {
      delete x.doc.metaSortKey;
      delete y.doc.metaSortKey;
    }
    return canonical(x.doc) === canonical(y.doc);
  } catch {
    return false;
  }
}
