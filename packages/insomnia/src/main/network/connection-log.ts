import electron from 'electron';
import fs from 'fs';
import { env } from 'node:process';
import path from 'path';
import { v4 as uuidV4 } from 'uuid';

import { getSetCookieHeaders } from '../../common/misc';
import * as models from '../../models';
import type { CookieJar } from '../../models/cookie-jar';
import { addSetCookiesToToughCookieJar } from '../../network/set-cookie-util';
import { readEventLog, readEventLogSince } from './event-log';

// What a streaming connection (websocket.ts, curl.ts) keeps as it runs: an
// event log and a timeline in the responses directory, a JSON entry a line,
// and the response that points at them.

export interface TimelineEntry {
  value: string;
  name: string;
  timestamp: number;
}

export const timelineText = (value: string): TimelineEntry => ({ value, name: 'Text', timestamp: Date.now() });

export interface ConnectionLogPaths {
  eventLogPath: string;
  timelinePath: string;
}

// The open connections' two files, by request id
export class ConnectionLogs {
  private readonly eventLogs = new Map<string, fs.WriteStream>();
  private readonly timelines = new Map<string, fs.WriteStream>();

  // New files for the response, or with `resume` the same ones carried on
  open(requestId: string, responseId: string, resume?: ConnectionLogPaths): ConnectionLogPaths {
    const responsesDir = path.join(env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData'), 'responses');
    fs.mkdirSync(responsesDir, { recursive: true });

    const flags = resume ? 'a' : 'w';
    const eventLogPath = resume?.eventLogPath || path.join(responsesDir, uuidV4() + '.response');
    this.eventLogs.set(requestId, fs.createWriteStream(eventLogPath, { flags }));
    const timelinePath = resume?.timelinePath || path.join(responsesDir, responseId + '.timeline');
    this.timelines.set(requestId, fs.createWriteStream(timelinePath, { flags }));
    return { eventLogPath, timelinePath };
  }

  event(requestId: string, event: object) {
    this.eventLogs.get(requestId)?.write(JSON.stringify(event) + '\n');
  }

  // written as given: its keys keep their order
  timeline(requestId: string, entry: object) {
    this.timelines.get(requestId)?.write(JSON.stringify(entry) + '\n');
  }

  text(requestId: string, value: string) {
    this.timeline(requestId, timelineText(value));
  }

  // the last event if there is one, and the timeline's last line
  close(requestId: string, message: string, event?: object) {
    if (event) {
      this.event(requestId, event);
    }
    this.eventLogs.get(requestId)?.end();
    this.eventLogs.delete(requestId);
    this.text(requestId, message);
    this.timelines.get(requestId)?.end();
    this.timelines.delete(requestId);
  }
}

interface ResponseModel<Patch> {
  create: (patch: Patch, maxResponses?: number) => Promise<{ _id: string }>;
}

// The response, shown as the request's active one
export const saveResponse = async <Patch>(model: ResponseModel<Patch>, requestId: string, patch: Patch, maxHistoryResponses: number) => {
  const res = await model.create(patch, maxHistoryResponses);
  models.requestMeta.updateOrCreateByParentId(requestId, { activeResponseId: res._id });
};

interface ErrorResponsePatch {
  _id: string;
  parentId: string;
  environmentId: string | null;
  timelinePath: string;
  statusMessage: string;
  error: string;
}

// A connection that failed before there was a response to show
export const saveErrorResponse = async (
  model: ResponseModel<ErrorResponsePatch>,
  responseId: string,
  requestId: string,
  environmentId: string | null,
  timelinePath: string,
  message: string,
) => {
  const settings = await models.settings.getOrCreate();
  await saveResponse(model, requestId, {
    _id: responseId,
    parentId: requestId,
    environmentId,
    timelinePath,
    statusMessage: 'Error',
    error: message,
  }, settings.maxHistoryResponses);
};

// The response's Set-Cookie headers into the jar, as cookies set by
// `currentUrl`, with what happened added to the timeline
export const storeSetCookies = async ({ headers, currentUrl, cookieJar, timeline }: {
  headers: { name: string; value: string }[];
  currentUrl: string;
  cookieJar: CookieJar;
  timeline: TimelineEntry[];
}) => {
  const setCookieStrings: string[] = getSetCookieHeaders(headers).map(h => h.value);
  const totalSetCookies = setCookieStrings.length;
  if (!totalSetCookies) {
    return;
  }
  const { cookies, rejectedCookies } = await addSetCookiesToToughCookieJar({ setCookieStrings, currentUrl, cookieJar });
  rejectedCookies.forEach(errorMessage => timeline.push(timelineText(`Rejected cookie: ${errorMessage}`)));
  const hasCookiesToPersist = totalSetCookies > rejectedCookies.length;
  if (hasCookiesToPersist) {
    await models.cookieJar.update(cookieJar, { cookies });
    timeline.push(timelineText(`Saved ${totalSetCookies} cookies`));
  }
};

// A response's events, latest first; none when it has no log
export const findEvents = async <T>(logPath: string | null | undefined): Promise<T[]> =>
  logPath ? readEventLog<T>(logPath) : [];

// what a window polling the log doesn't have yet
export const findEventsSince = async <T>(logPath: string | null | undefined, known: number): Promise<{ total: number; added: T[] }> =>
  logPath ? readEventLogSince<T>(logPath, known) : { total: 0, added: [] };
