/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { WebSocket } from 'ws';

import type { CookieJar } from '../../../models/cookie-jar';
import { webSockets } from '../websocket';

jest.mock('ws', () => {
  const { EventEmitter } = jest.requireActual<typeof import('node:events')>('node:events');
  // a socket that connects to nothing: the test plays the server
  class MockSocket extends EventEmitter {
    static OPEN = 1;
    static sockets: MockSocket[] = [];
    readyState = 0;
    url: string;
    _req = { _header: 'GET /socket HTTP/1.1' };
    constructor(url: string) {
      super();
      this.url = url;
      MockSocket.sockets.push(this);
    }
    addEventListener(name: string, listener: (...args: any[]) => void) {
      this.on(name, listener);
    }
    send() {}
    close(code = 1000, reason = '') {
      this.drop(code, reason, true);
    }
    // as ws does: 'open' in the same turn as 'upgrade'
    accept() {
      this.emit('upgrade', { statusCode: 101, statusMessage: 'Switching Protocols', httpVersion: '1.1', headers: { upgrade: 'websocket' } });
      this.readyState = MockSocket.OPEN;
      this.emit('open');
    }
    drop(code: number, reason = '', wasClean = false) {
      this.readyState = 3;
      this.emit('close', { code, reason, wasClean });
    }
  }
  return { WebSocket: MockSocket };
});
interface MockSocket {
  accept: () => void;
  drop: (code: number) => void;
}
const sockets = (WebSocket as unknown as { sockets: MockSocket[] }).sockets;

jest.mock('electron', () => {
  const electron = {
    app: { on: () => {}, getPath: () => '' },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: () => {}, on: () => {} },
  };
  return { __esModule: true, default: electron, ...electron };
});

const mockCreated: { timelinePath: string }[] = [];
jest.mock('../../../models', () => {
  const request = {
    _id: 'req_1',
    url: 'ws://example.test/socket',
    settingSendCookies: true,
    settingStoreCookies: true,
    settingFollowRedirects: 'global',
    reconnect: { enabled: true, delaySeconds: 1, maxAttempts: 3 },
  };
  return {
    webSocketRequest: { getById: async () => request },
    workspaceMeta: { getOrCreateByParentId: async () => ({ activeEnvironmentId: null }) },
    environment: { getById: async () => null, getOrCreateForParentId: async () => ({ _id: 'env_base' }) },
    caCertificate: { findByParentId: async () => null },
    clientCertificate: { findByParentId: async () => [] },
    settings: { getOrCreate: async () => ({ maxHistoryResponses: 20, followRedirects: true, validateSSL: true, maxRedirects: 10 }) },
    webSocketResponse: {
      create: async (patch: { _id: string; timelinePath: string }) => {
        mockCreated.push(patch);
        return patch;
      },
      getById: async () => null,
      getLatestByParentId: async () => null,
    },
    requestMeta: { updateOrCreateByParentId: () => {} },
    cookieJar: { update: async () => {} },
  };
});
jest.mock('../proxy', () => ({ proxyFor: async () => null, describeProxy: () => '' }));
jest.mock('../ca-bundle', () => ({ getCaBundle: async () => undefined }));

const until = async (condition: () => boolean, what: string) => {
  for (let tries = 0; tries < 250 && !condition(); tries++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (!condition()) {
    throw new Error(`timed out waiting for ${what}`);
  }
};
const values = (file: string): string[] => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).value);

describe('a WebSocket that reconnects', () => {
  let dir: string;
  const dataPath = process.env['INSOMNIA_DATA_PATH'];
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'websocket-reconnect-'));
    process.env['INSOMNIA_DATA_PATH'] = dir;
  });
  afterAll(() => {
    if (dataPath === undefined) {
      delete process.env['INSOMNIA_DATA_PATH'];
    } else {
      process.env['INSOMNIA_DATA_PATH'] = dataPath;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the handshake to the timeline before the connection is established', async () => {
    await webSockets.open({
      requestId: 'req_1',
      workspaceId: 'wrk_1',
      url: 'ws://example.test/socket',
      headers: [],
      authentication: {},
      cookieJar: { _id: 'jar_1', cookies: [] } as unknown as CookieJar,
    });
    expect(sockets).toHaveLength(1);
    sockets[0].accept();
    await until(() => mockCreated.length === 1, 'the response');

    // the connection drops, and is opened again into the same response
    sockets[0].drop(1006);
    await until(() => sockets.length === 2, 'the reconnect');
    sockets[1].accept();
    webSockets.close('req_1');

    const { timelinePath } = mockCreated[0];
    await until(() => values(timelinePath).includes('Closing connection with code 1000'), 'the timeline');
    const timeline = values(timelinePath);
    expect(timeline.slice(timeline.indexOf('Reconnecting, attempt 1'))).toEqual([
      'Reconnecting, attempt 1',
      'Preparing request to ws://example.test/socket',
      expect.stringMatching(/^Current time is /),
      'Using HTTP 1.1',
      'GET /socket HTTP/1.1',
      'HTTP/1.1 101 Switching Protocols',
      'upgrade: websocket',
      'WebSocket connection established',
      'Closing connection with code 1000',
    ]);
    // no second response for the reconnect
    expect(mockCreated).toHaveLength(1);
    expect(await webSockets.isOpen('req_1')).toBe(false);
  });
});
