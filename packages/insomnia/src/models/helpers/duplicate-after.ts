import { database as db, type ModelQuery } from '../../common/database';
import type { BaseModel } from '../index';

type Sortable = BaseModel & { metaSortKey: number };

/**
 * Copies a document, placing the copy halfway between the original and the
 * next document of that type by sort key (or 50 after it when it is the last).
 * A `metaSortKey` in the patch wins.
 *
 * The next document is looked up by sort key alone, not among the original's
 * siblings.
 */
export async function duplicateAfter<T extends Sortable>(type: string, doc: T, patch: Partial<T> = {}) {
  const query: ModelQuery<Sortable> = { metaSortKey: { $gt: doc.metaSortKey } };
  const [next] = await db.find<T>(type, query, { metaSortKey: 1 });
  const nextSortKey = next ? next.metaSortKey : doc.metaSortKey + 100;
  const metaSortKey = doc.metaSortKey + (nextSortKey - doc.metaSortKey) / 2;
  return db.duplicate<T>(doc, { metaSortKey, ...patch });
}
