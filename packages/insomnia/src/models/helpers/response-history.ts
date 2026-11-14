import fs from 'fs';

import { database as db, Query } from '../../common/database';
import type { BaseModel } from '../index';
import * as models from '../index';
import * as requestOperations from './request-operations';

// What the response models (HTTP and WebSocket) share: each request keeps a
// history of its last few responses, optionally per environment, and each
// response keeps its body (or event log) and its timeline in files.

type HistoryResponse = BaseModel & {
  environmentId: string | null;
  requestVersionId: string | null;
};

// Delete a removed response's files. `bodyPath` is the HTTP body or the
// WebSocket event log
export function removeFiles(
  bodyPath: string,
  timelinePath: string,
  consoleLog: typeof console.log = console.log,
) {
  fs.unlink(bodyPath, () => {
    consoleLog(`[response] Delete body ${bodyPath}`);
  });
  fs.unlink(timelinePath, () => {
    consoleLog(`[response] Delete timeline ${timelinePath}`);
  });
}

export async function removeForRequest(type: string, parentId: string, environmentId?: string | null) {
  const settings = await models.settings.getOrCreate();
  const query: Record<string, any> = {
    parentId,
  };

  // Only add if not undefined. null is not the same as undefined
  //  null: find responses sent from base environment
  //  undefined: find all responses
  if (environmentId !== undefined && settings.filterResponsesByEnv) {
    query.environmentId = environmentId;
  }

  // Also delete legacy responses here or else the user will be confused as to
  // why some responses are still showing in the UI.
  await db.removeWhere(type, query);
}

export async function getLatestForRequest<T extends HistoryResponse>(
  type: string,
  requestId: string,
  environmentId: string | null,
): Promise<T | null> {
  const query: Query = {
    parentId: requestId,
  };

  // Filter responses by environment if setting is enabled
  if ((await models.settings.getOrCreate()).filterResponsesByEnv) {
    query.environmentId = environmentId;
  }

  const responses = await db.findMostRecentlyModified<T>(type, query, 1);
  const response = responses[0] as T | null | undefined;
  return response || null;
}

// Create a response for the request `parentId`, keeping only the request's
// `maxResponses` most recent earlier ones. Sets `patch.requestVersionId`
export async function create<T extends HistoryResponse>(
  type: string,
  parentId: string,
  patch: Partial<T>,
  maxResponses: number,
): Promise<T> {
  // Create request version snapshot
  const request = await requestOperations.getById(parentId);
  const requestVersion = request ? await models.requestVersion.create(request) : null;
  patch.requestVersionId = requestVersion ? requestVersion._id : null;
  // Filter responses by environment if setting is enabled
  const query: Query = {
    parentId,
  };

  if (
    (await models.settings.getOrCreate()).filterResponsesByEnv &&
    patch.hasOwnProperty('environmentId')
  ) {
    query.environmentId = patch.environmentId;
  }

  // Delete all other responses before creating the new one
  const allResponses = await db.findMostRecentlyModified<T>(type, query, Math.max(1, maxResponses));
  const recentIds = allResponses.map(r => r._id);
  // Remove all that were in the last query, except the first `maxResponses` IDs
  await db.removeWhere(type, {
    ...query,
    _id: {
      $nin: recentIds,
    },
  });
  // Actually create the new response
  const response = await db.docCreate<T>(type, patch);
  await models.requestVersion.removeUnused(parentId, type);
  return response;
}
