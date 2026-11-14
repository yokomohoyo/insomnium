import { BaseModel } from '../models';
import { isWorkspace, Workspace } from '../models/workspace';

type ResetModelKeys<T extends BaseModel> = {
  [K in keyof T]?: T[K] | null;
};

// Keys for VCS to reset before computing changes
//  We can't always delete keys
//  If we delete a key that previously existed (even as null), we then have a different hash because of the deletion
//  Therefore, we have to set it back to a default value
const RESET_WORKSPACE_KEYS: ResetModelKeys<Workspace> = {
  parentId: null,
};

export const resetKeys = <T extends BaseModel>(doc: T) => {
  if (isWorkspace(doc)) {
    (Object.keys(RESET_WORKSPACE_KEYS) as (keyof typeof RESET_WORKSPACE_KEYS)[])
      .forEach(key => {
        // @ts-expect-error -- mapping unsoundness
        doc[key] = RESET_WORKSPACE_KEYS[key];
      });
  }
};
