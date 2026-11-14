import { database as db } from '../common/database';
import * as responseHistory from './helpers/response-history';
import type { BaseModel } from './index';
import { ResponseHeader } from './response';

export const name = 'WebSocket Response';

export const type = 'WebSocketResponse';

export const prefix = 'ws-res';

export const canDuplicate = false;

export const canSync = false;

export interface BaseWebSocketResponse {
  environmentId: string | null;
  statusCode: number;
  statusMessage: string;
  httpVersion: string;
  contentType: string;
  url: string;
  elapsedTime: number;
  headers: ResponseHeader[];
  // Event logs are stored on the filesystem
  eventLogPath: string;
  // Actual timelines are stored on the filesystem
  timelinePath: string;
  error: string;
  requestVersionId: string | null;
  settingStoreCookies: boolean | null;
  settingSendCookies: boolean | null;
}

export type WebSocketResponse = BaseModel & BaseWebSocketResponse;

export const isWebSocketResponse = (model: Pick<BaseModel, 'type'>): model is WebSocketResponse => (
  model.type === type
);

export function init(): BaseWebSocketResponse {
  return {
    statusCode: 0,
    statusMessage: '',
    httpVersion: '',
    contentType: '',
    url: '',
    elapsedTime: 0,
    headers: [],
    timelinePath: '',
    eventLogPath: '',
    error: '',
    requestVersionId: null,
    settingStoreCookies: null,
    settingSendCookies: null,
    environmentId: null,
  };
}

export function migrate(doc: Response) {
  return doc;
}

export function hookDatabaseInit(consoleLog: typeof console.log = console.log) {
  consoleLog('[db] Init websocket-responses DB');
}

export function hookRemove(doc: WebSocketResponse, consoleLog: typeof console.log = console.log) {
  responseHistory.removeFiles(doc.eventLogPath, doc.timelinePath, consoleLog);
}

export function getById(id: string) {
  return db.get<WebSocketResponse>(type, id);
}

export function findByParentId(parentId: string) {
  return db.find<WebSocketResponse>(type, { parentId: parentId });
}

export async function all() {
  return db.all<WebSocketResponse>(type);
}

export function removeForRequest(parentId: string, environmentId?: string | null) {
  return responseHistory.removeForRequest(type, parentId, environmentId);
}

export function remove(response: WebSocketResponse) {
  return db.remove(response);
}

export async function create(patch: Partial<WebSocketResponse> = {}, maxResponses = 20) {
  if (!patch.parentId) {
    throw new Error('New Response missing `parentId`');
  }

  return responseHistory.create<WebSocketResponse>(type, patch.parentId, patch, maxResponses);
}

export function getLatestForRequest(
  requestId: string,
  environmentId: string | null,
) {
  return responseHistory.getLatestForRequest<WebSocketResponse>(type, requestId, environmentId);
}

export function getLatestByParentId(parentId: string) {
  return db.getMostRecentlyModified<WebSocketResponse>(type, {
    parentId,
  });
}
