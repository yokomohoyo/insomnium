import { useEffect, useState } from 'react';

import { database as db } from '../../common/database';
import { inheritedAuthFolder, inheritedHeaders } from '../../common/folder-inheritance';
import * as models from '../../models';
import type { BaseModel } from '../../models';
import type { RequestGroup } from '../../models/request-group';

interface FolderInheritance {
  // the folder whose auth the request uses when it has none
  authFolder?: RequestGroup;
  headers: ReturnType<typeof inheritedHeaders>;
}

// What a request gets from its folders, to show beside its own. Reloaded with
// the request, which the route reloads after any edit, a folder's included.
export function useFolderInheritance(request: BaseModel | undefined): FolderInheritance {
  const [inheritance, setInheritance] = useState<FolderInheritance>({ headers: [] });
  useEffect(() => {
    let current = true;
    if (!request) {
      setInheritance({ headers: [] });
      return;
    }
    db.withAncestors(request, [models.requestGroup.type]).then(ancestors => {
      if (current) {
        setInheritance({ authFolder: inheritedAuthFolder(ancestors), headers: inheritedHeaders(ancestors) });
      }
    });
    return () => {
      current = false;
    };
  }, [request]);
  return inheritance;
}
