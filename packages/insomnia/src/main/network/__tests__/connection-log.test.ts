/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import * as models from '../../../models';
import type { CookieJar } from '../../../models/cookie-jar';
import {
  ConnectionLogs,
  findEvents,
  findEventsSince,
  saveErrorResponse,
  saveResponse,
  storeSetCookies,
  type TimelineEntry,
} from '../connection-log';

jest.mock('../../../models', () => ({
  settings: { getOrCreate: jest.fn() },
  requestMeta: { updateOrCreateByParentId: jest.fn() },
  cookieJar: { update: jest.fn() },
}));

const lines = (file: string) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
// a stream's writes are on disk once it has opened its file and finished
const closed = async (paths: { eventLogPath: string; timelinePath: string }) => {
  for (let tries = 0; tries < 100 && !(fs.existsSync(paths.eventLogPath) && fs.existsSync(paths.timelinePath)); tries++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await new Promise(resolve => setTimeout(resolve, 50));
};

let dir: string;
const dataPath = process.env['INSOMNIA_DATA_PATH'];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connection-log-'));
  process.env['INSOMNIA_DATA_PATH'] = dir;
  jest.clearAllMocks();
  jest.mocked(models.settings.getOrCreate).mockResolvedValue({ maxHistoryResponses: 7 } as Awaited<ReturnType<typeof models.settings.getOrCreate>>);
});
afterEach(() => {
  if (dataPath === undefined) {
    delete process.env['INSOMNIA_DATA_PATH'];
  } else {
    process.env['INSOMNIA_DATA_PATH'] = dataPath;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ConnectionLogs', () => {
  it('opens an event log and a timeline in the responses directory', async () => {
    const logs = new ConnectionLogs();

    const paths = logs.open('req_1', 'res_1');
    const { eventLogPath, timelinePath } = paths;
    logs.close('req_1', 'done');
    await closed(paths);

    expect(path.dirname(eventLogPath)).toBe(path.join(dir, 'responses'));
    expect(path.basename(eventLogPath)).toMatch(/^[0-9a-f-]{36}\.response$/);
    expect(timelinePath).toBe(path.join(dir, 'responses', 'res_1.timeline'));
  });

  it('writes a JSON entry a line, and the last event and message on closing', async () => {
    const logs = new ConnectionLogs();
    const paths = logs.open('req_1', 'res_1');
    const { eventLogPath, timelinePath } = paths;

    logs.event('req_1', { _id: 'a', type: 'open' });
    logs.text('req_1', 'connected');
    logs.timeline('req_1', { name: 'HeaderIn', value: 'x: y', timestamp: 1 });
    logs.close('req_1', 'Closing connection', { _id: 'b', type: 'close' });
    await closed(paths);

    expect(lines(eventLogPath)).toEqual([{ _id: 'a', type: 'open' }, { _id: 'b', type: 'close' }]);
    expect(lines(timelinePath)).toEqual([
      { value: 'connected', name: 'Text', timestamp: expect.any(Number) },
      { name: 'HeaderIn', value: 'x: y', timestamp: 1 },
      { value: 'Closing connection', name: 'Text', timestamp: expect.any(Number) },
    ]);
    // as given, and as text: value, name, timestamp
    expect(fs.readFileSync(timelinePath, 'utf8').split('\n')[1]).toBe('{"name":"HeaderIn","value":"x: y","timestamp":1}');
    expect(fs.readFileSync(timelinePath, 'utf8').split('\n')[0]).toMatch(/^\{"value":"connected","name":"Text","timestamp":\d+\}$/);
  });

  it('writes nothing for a request that is not open, or was closed', async () => {
    const logs = new ConnectionLogs();
    const paths = logs.open('req_1', 'res_1');
    const { eventLogPath, timelinePath } = paths;
    logs.close('req_1', 'done');

    logs.event('req_1', { _id: 'late' });
    logs.text('req_1', 'late');
    logs.event('req_2', { _id: 'other' });
    logs.close('req_2', 'never opened');
    await closed(paths);

    expect(lines(eventLogPath)).toEqual([]);
    expect(lines(timelinePath).map(entry => entry.value)).toEqual(['done']);
  });

  it('carries on in the same files when resuming', async () => {
    const logs = new ConnectionLogs();
    const first = logs.open('req_1', 'res_1');
    logs.event('req_1', { _id: 'a' });
    logs.close('req_1', 'dropped');
    await closed(first);

    const again = logs.open('req_1', 'res_1', first);
    logs.event('req_1', { _id: 'b' });
    logs.close('req_1', 'closed');
    await closed(again);

    expect(again).toEqual(first);
    expect(lines(first.eventLogPath)).toEqual([{ _id: 'a' }, { _id: 'b' }]);
    expect(lines(first.timelinePath).map(entry => entry.value)).toEqual(['dropped', 'closed']);
  });

  it('starts the files afresh when not resuming', async () => {
    const logs = new ConnectionLogs();
    const first = logs.open('req_1', 'res_1');
    logs.close('req_1', 'first');
    await closed(first);

    const second = logs.open('req_1', 'res_1');
    logs.close('req_1', 'second');
    await closed(second);

    expect(second.timelinePath).toBe(first.timelinePath);
    expect(second.eventLogPath).not.toBe(first.eventLogPath);
    expect(lines(second.timelinePath).map(entry => entry.value)).toEqual(['second']);
  });
});

describe('saveResponse()', () => {
  it('creates the response and makes it the active one', async () => {
    const create = jest.fn(async (patch: { _id: string }) => ({ _id: patch._id }));

    await saveResponse({ create }, 'req_1', { _id: 'res_1' }, 3);

    expect(create).toHaveBeenCalledWith({ _id: 'res_1' }, 3);
    expect(models.requestMeta.updateOrCreateByParentId).toHaveBeenCalledWith('req_1', { activeResponseId: 'res_1' });
  });
});

describe('saveErrorResponse()', () => {
  it('creates an error response within the history setting', async () => {
    const create = jest.fn(async (patch: { _id: string }) => ({ _id: patch._id }));

    await saveErrorResponse({ create }, 'res_1', 'req_1', null, '/tmp/res_1.timeline', 'refused');

    expect(create).toHaveBeenCalledWith({
      _id: 'res_1',
      parentId: 'req_1',
      environmentId: null,
      timelinePath: '/tmp/res_1.timeline',
      statusMessage: 'Error',
      error: 'refused',
    }, 7);
    expect(models.requestMeta.updateOrCreateByParentId).toHaveBeenCalledWith('req_1', { activeResponseId: 'res_1' });
  });
});

describe('storeSetCookies()', () => {
  const jar = () => ({ _id: 'jar_1', cookies: [] } as unknown as CookieJar);
  const stored = () => (jest.mocked(models.cookieJar.update).mock.calls[0][1].cookies || []).map(cookie => `${cookie.key}=${cookie.value}@${cookie.domain}`);

  it('saves the cookies as set by the URL it is given', async () => {
    const timeline: TimelineEntry[] = [];
    const cookieJar = jar();

    await storeSetCookies({
      headers: [{ name: 'Set-Cookie', value: 'a=1' }, { name: 'content-type', value: 'text/plain' }, { name: 'set-cookie', value: 'b=2' }],
      currentUrl: 'https://after-redirect.example/stream',
      cookieJar,
      timeline,
    });

    expect(models.cookieJar.update).toHaveBeenCalledWith(cookieJar, { cookies: expect.any(Array) });
    expect(stored()).toEqual(['a=1@after-redirect.example', 'b=2@after-redirect.example']);
    expect(timeline.map(entry => entry.value)).toEqual(['Saved 2 cookies']);
  });

  it('notes a rejected cookie, and saves the rest', async () => {
    const timeline: TimelineEntry[] = [];

    await storeSetCookies({
      headers: [{ name: 'set-cookie', value: 'a=1; Domain=elsewhere.example' }, { name: 'set-cookie', value: 'b=2' }],
      currentUrl: 'https://example.com/',
      cookieJar: jar(),
      timeline,
    });

    expect(stored()).toEqual(['b=2@example.com']);
    expect(timeline.map(entry => entry.value)).toEqual([expect.stringMatching(/^Rejected cookie: /), 'Saved 2 cookies']);
    expect(timeline.every(entry => entry.name === 'Text')).toBe(true);
  });

  it('saves nothing when every cookie is rejected', async () => {
    const timeline: TimelineEntry[] = [];

    await storeSetCookies({
      headers: [{ name: 'set-cookie', value: 'a=1; Domain=elsewhere.example' }],
      currentUrl: 'https://example.com/',
      cookieJar: jar(),
      timeline,
    });

    expect(models.cookieJar.update).not.toHaveBeenCalled();
    expect(timeline).toHaveLength(1);
  });

  it('does nothing without Set-Cookie headers', async () => {
    const timeline: TimelineEntry[] = [];

    await storeSetCookies({ headers: [{ name: 'content-type', value: 'text/plain' }], currentUrl: 'https://example.com/', cookieJar: jar(), timeline });

    expect(models.cookieJar.update).not.toHaveBeenCalled();
    expect(timeline).toEqual([]);
  });
});

describe('findEvents()', () => {
  it('reads the log latest first, and what was added since', async () => {
    const file = path.join(dir, 'log.response');
    fs.writeFileSync(file, '{"_id":"a"}\n{"_id":"b"}\n');

    expect(await findEvents(file)).toEqual([{ _id: 'b' }, { _id: 'a' }]);
    expect(await findEventsSince(file, 1)).toEqual({ total: 2, added: [{ _id: 'b' }] });
  });

  it('gives nothing for a response without a log', async () => {
    expect(await findEvents(undefined)).toEqual([]);
    expect(await findEvents('')).toEqual([]);
    expect(await findEventsSince(null, 3)).toEqual({ total: 0, added: [] });
  });
});
