import * as models from '../models';
import type { BaseModel } from '../models';
import { isRequest, type Request } from '../models/request';
import { isRequestGroup } from '../models/request-group';
import type { Response } from '../models/response';
import { isWorkspace, type Workspace } from '../models/workspace';
import { database as db } from './database';

export interface HistoryEntry {
  response: Response;
  request: Request;
  workspace: Workspace;
  // the folders it's in, outermost first
  folders: string[];
}

// The latest responses to every collection's requests, newest first, with the
// request and collection each was for. Responses to requests since deleted,
// or no longer in a collection, are left out.
export async function recentHistory(limit = 200): Promise<HistoryEntry[]> {
  const responses = await db.findMostRecentlyModified<Response>(models.response.type, {}, limit);
  const places = new Map<string, Omit<HistoryEntry, 'response'> | null>();
  const entries: HistoryEntry[] = [];
  for (const response of responses) {
    if (!places.has(response.parentId)) {
      const request = await models.request.getById(response.parentId);
      const ancestors: BaseModel[] = request ? await db.withAncestors<BaseModel>(request, [models.requestGroup.type, models.workspace.type]) : [];
      const workspace = ancestors.find(isWorkspace);
      places.set(response.parentId, request && isRequest(request) && workspace ? {
        request,
        workspace,
        folders: ancestors.filter(isRequestGroup).map(folder => folder.name).reverse(),
      } : null);
    }
    const place = places.get(response.parentId);
    if (place) {
      entries.push({ response, ...place });
    }
  }
  return entries;
}
