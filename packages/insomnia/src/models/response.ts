import fs from 'fs';
import { pipeline, Readable } from 'stream';
import zlib from 'zlib';

import { database as db } from '../common/database';
import type { ResponseTimelineEntry } from '../main/network/libcurl-promise';
import type { Visualization } from '../common/visualizer';
import type { AssertionResult } from '../network/assertions';
import * as responseHistory from './helpers/response-history';
import type { BaseModel } from './index';

export const name = 'Response';

export const type = 'Response';

export const prefix = 'res';

export const canDuplicate = false;

export const canSync = false;
// kept by initModel when set (see BaseResponse)
export const optionalKeys = ['assertionResults', 'scriptLogs', 'timings', 'visualization'];

// When each part of the exchange was done, in milliseconds from the start, as
// libcurl measures it: the name lookup, the connection, the TLS handshake (0
// without TLS) and the response's first byte
export interface ResponseTimings {
  dns: number;
  connect: number;
  tls: number;
  firstByte: number;
}

export interface ResponseHeader {
  name: string;
  value: string;
}

type Compression = 'zip' | null | '__NEEDS_MIGRATION__' | undefined;

export interface BaseResponse {
  environmentId: string | null;
  statusCode: number;
  statusMessage: string;
  httpVersion: string;
  contentType: string;
  url: string;
  bytesRead: number;
  bytesContent: number;
  elapsedTime: number;
  timings?: ResponseTimings;
  headers: ResponseHeader[];
  bodyPath: string;
  // Actual bodies are stored on the filesystem
  timelinePath: string;
  // Actual timelines are stored on the filesystem
  bodyCompression: Compression;
  error: string;
  requestVersionId: string | null;
  // Things from the request
  settingStoreCookies: boolean | null;
  settingSendCookies: boolean | null;
  // the request's assertions, checked when it was sent
  assertionResults?: AssertionResult[];
  // what the request's scripts logged with console
  scriptLogs?: { level: string; message: string }[];
  // what the after-response script set with visualizer.set
  visualization?: Visualization;
}

export type Response = BaseModel & BaseResponse;

export const isResponse = (model: Pick<BaseModel, 'type'>): model is Response => (
  model.type === type
);

export function init(): BaseResponse {
  return {
    statusCode: 0,
    statusMessage: '',
    httpVersion: '',
    contentType: '',
    url: '',
    bytesRead: 0,
    // -1 means that it was legacy and this property didn't exist yet
    bytesContent: -1,
    elapsedTime: 0,
    headers: [],
    // Actual timelines are stored on the filesystem
    timelinePath: '',
    // Actual bodies are stored on the filesystem
    bodyPath: '',
    // For legacy bodies
    bodyCompression: '__NEEDS_MIGRATION__',
    error: '',
    // Things from the request
    requestVersionId: null,
    settingStoreCookies: null,
    settingSendCookies: null,
    // Responses sent before environment filtering will have a special value
    // so they don't show up at all when filtering is on.
    environmentId: '__LEGACY__',
  };
}

export function migrate(doc: Response) {
  try {
    return migrateBodyCompression(doc);
  } catch (e) {
    console.log('[db] Error during response migration', e);
    throw e;
  }
}

export function hookDatabaseInit(consoleLog: typeof console.log = console.log) {
  consoleLog('[db] Init responses DB');
}

export function hookRemove(doc: Response, consoleLog: typeof console.log = console.log) {
  responseHistory.removeFiles(doc.bodyPath, doc.timelinePath, consoleLog);
}

export function getById(id: string) {
  return db.get<Response>(type, id);
}

export function findByParentId(parentId: string) {
  return db.find<Response>(type, { parentId: parentId });
}

export async function all() {
  return db.all<Response>(type);
}

export function removeForRequest(parentId: string, environmentId?: string | null) {
  return responseHistory.removeForRequest(type, parentId, environmentId);
}

export function remove(response: Response) {
  return db.remove(response);
}

export function getLatestForRequest(
  requestId: string,
  environmentId: string | null,
) {
  return responseHistory.getLatestForRequest<Response>(type, requestId, environmentId);
}

export async function create(patch: Partial<Response> = {}, maxResponses = 20): Promise<Response> {
  if (!patch.parentId) {
    console.log('[db] Attempted to create response without `parentId`', patch);
    throw new Error('New Response missing `parentId`');
  }

  return responseHistory.create<Response>(type, patch.parentId, patch, maxResponses);
}

export function getLatestByParentId(parentId: string) {
  return db.getMostRecentlyModified<Response>(type, {
    parentId,
  });
}

export const getBodyStream = (
  response?: { bodyPath?: string; bodyCompression?: Compression },
  readFailureValue?: string,
): Readable | string | null => {
  if (!response?.bodyPath) {
    return null;
  }
  try {
    fs.statSync(response?.bodyPath);
  } catch (err) {
    console.warn('Failed to read response body', err.message);
    return readFailureValue === undefined ? null : readFailureValue;
  }
  if (response?.bodyCompression === 'zip') {
    // Unlike pipe(), pipeline() passes a file read error on to the returned
    // gunzip stream, so its consumer sees the error instead of waiting forever.
    // pipeline() handles the error itself, so log it for consumers that do not
    // listen for it, but not the errors that only mean the consumer stopped
    // reading early.
    return pipeline(fs.createReadStream(response?.bodyPath), zlib.createGunzip(), err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ABORT_ERR') {
        console.warn('Failed to read response body', err.message);
      }
    });
  } else {
    return fs.createReadStream(response?.bodyPath);
  }
};

export const getBodyBuffer = (
  response?: { bodyPath?: string; bodyCompression?: Compression },
  readFailureValue?: string,
): Buffer | string | null => {
  if (!response?.bodyPath) {
    // No body, so return empty Buffer
    return Buffer.alloc(0);
  }
  try {
    const rawBuffer = fs.readFileSync(response?.bodyPath);
    if (response?.bodyCompression === 'zip') {
      return zlib.gunzipSync(rawBuffer);
    } else {
      return rawBuffer;
    }
  } catch (err) {
    console.warn('Failed to read response body', err.message);
    return readFailureValue === undefined ? null : readFailureValue;
  }
};

// Read at most ~maxBytes of the (decompressed) body, then stop - streams and
// gunzips on the fly instead of materializing a huge body to slice it, tearing
// down both streams early (no fd leak). `fullSize` is exact only when the whole
// body fit; null when we stopped early.
export const getBoundedBodyBuffer = async (
  response: { bodyPath?: string; bodyCompression?: Compression } | undefined,
  maxBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean; fullSize: number | null }> => {
  if (!response?.bodyPath) {
    return { buffer: Buffer.alloc(0), truncated: false, fullSize: 0 };
  }
  try {
    fs.statSync(response.bodyPath);
  } catch (err) {
    console.warn('Failed to read response body', err.message);
    return { buffer: Buffer.alloc(0), truncated: false, fullSize: null };
  }
  const fileStream = fs.createReadStream(response.bodyPath);
  // Unlike pipe(), pipeline() passes a file read error on to gunzip, so the
  // for-await below sees it instead of waiting forever, and closes the file
  // when gunzip is closed. The for-await reports the error, so the callback
  // does not.
  const source: Readable = response.bodyCompression === 'zip'
    ? pipeline(fileStream, zlib.createGunzip(), () => {})
    : fileStream;
  // One chunk past maxBytes so we can tell "exactly maxBytes" from "more remained".
  const cap = maxBytes + 8;
  const chunks: Buffer[] = [];
  let total = 0;
  let reachedCap = false;
  let readError = false;
  try {
    for await (const chunk of source) {
      const buf = chunk as Buffer;
      chunks.push(buf);
      total += buf.length;
      if (total >= cap) {
        reachedCap = true;
        break;
      }
    }
  } catch (err) {
    readError = true;
    console.warn('Failed to read response body', (err as Error).message);
    // Return whatever we managed to read rather than throwing.
  } finally {
    // Also closes the file, through pipeline(), when we stopped early
    source.destroy();
  }
  const buffer = Buffer.concat(chunks);
  return {
    buffer,
    // Read error (e.g. corrupt gzip): treat as truncated, not a complete body.
    truncated: readError || buffer.length > maxBytes,
    // null = size unknown: we deliberately stopped, or errored mid-read.
    fullSize: (reachedCap || readError) ? null : buffer.length,
  };
};

export function getTimeline(response: Response, showBody?: boolean) {
  const { timelinePath } = response;

  if (!timelinePath) {
    return [];
  }

  try {
    const rawBuffer = fs.readFileSync(timelinePath);
    const timelineString = rawBuffer.toString();
    const timeline = JSON.parse(timelineString) as ResponseTimelineEntry[];

    const body: ResponseTimelineEntry[] = showBody ? [
      {
        name: 'DataOut',
        timestamp: Date.now(),
        // getBodyBuffer gunzips 'zip' bodies; a raw read would emit binary gzip.
        value: (getBodyBuffer(response, '') as Buffer | string).toString(),
      },
    ] : [];
    const output = [...timeline, ...body];
    return output;
  } catch (err) {
    console.warn('Failed to read response body', err.message);
    return [];
  }
}

function migrateBodyCompression(doc: Response) {
  if (doc.bodyCompression === '__NEEDS_MIGRATION__') {
    doc.bodyCompression = 'zip';
  }

  return doc;
}
