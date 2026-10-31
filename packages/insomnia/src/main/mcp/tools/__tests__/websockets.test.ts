import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerWebSocketTools, type WebSocketControls } from '../websockets';

interface Logged { type: string; timestamp: number; direction?: string; data?: string }
interface Opened { requestId: string; workspaceId: string; url: string; headers: { name: string; value: string }[] }

window.app = electron.app;

// the app's connections (main/network/websocket.ts), without a network
const opened: Opened[] = [];
const sent: { requestId: string; payload: string }[] = [];
const open = new Set<string>();
const log: Logged[] = [];
const controls = {
  open: async (options: Opened) => {
    opened.push(options);
    open.add(options.requestId);
    log.unshift({ type: 'open', timestamp: 1000 });
  },
  send: async (options: { requestId: string; payload: string }) => {
    sent.push(options);
    log.unshift({ type: 'message', timestamp: 2000, direction: 'OUTGOING', data: options.payload });
  },
  close: (requestId: string) => {
    open.delete(requestId);
  },
  isOpen: async (requestId: string) => open.has(requestId),
  events: async () => log,
} as unknown as WebSocketControls;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerWebSocketTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, controls, { waitMs: 200 });

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the WebSocket tools', () => {
  let workspaceId: string;
  let socketId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    opened.length = 0;
    sent.length = 0;
    log.length = 0;
    open.clear();
    workspaceId = (await models.workspace.create({ name: 'Live' }))._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { host: 'localhost:4010', room: 'lobby', name: 'Pat' } });
    socketId = (await models.webSocketRequest.create({
      parentId: workspaceId,
      name: 'Chat',
      url: 'ws://{{ host }}/chat',
      parameters: [{ name: 'room', value: '{{ room }}' }],
      headers: [{ name: 'X-Who', value: '{{ name }}' }],
    }))._id;
  });

  it('connects rendered in the environment, sends a rendered message, reads newest first, and closes', async () => {
    expect(await call('connect_websocket', { requestId: socketId })).toEqual({ body: { ok: true, open: true }, isError: false });
    expect(opened[0]).toMatchObject({ requestId: socketId, workspaceId, url: 'ws://localhost:4010/chat?room=lobby', headers: [expect.objectContaining({ name: 'X-Who', value: 'Pat' })] });

    expect(await call('send_websocket_message', { requestId: socketId, message: 'hi from {{ name }}' })).toEqual({ body: { ok: true }, isError: false });
    expect(sent).toEqual([{ requestId: socketId, payload: 'hi from Pat' }]);

    const read = (await call('read_websocket_messages', { requestId: socketId, limit: 50 })).body;
    expect(read).toMatchObject({ open: true, total: 2, events: [{ type: 'message', direction: 'OUTGOING', data: 'hi from Pat' }, { type: 'open' }] });

    expect((await call('close_websocket', { requestId: socketId })).body).toEqual({ ok: true, wasOpen: true });
    expect(await call('send_websocket_message', { requestId: socketId, message: 'x' })).toEqual({ body: { error: 'not connected: connect_websocket first' }, isError: true });
  });

  it('allows only ws and wss, blocks cloud metadata hosts, and sends Socket.IO and MQTT from the app', async () => {
    const http = (await models.webSocketRequest.create({ parentId: workspaceId, name: 'Not ws', url: 'http://localhost:4010/chat' }))._id;
    expect((await call('connect_websocket', { requestId: http })).body.error).toMatch(/scheme 'http:' is not allowed \(only ws and wss\)/);
    const metadata = (await models.webSocketRequest.create({ parentId: workspaceId, name: 'Metadata', url: 'ws://169.254.169.254/' }))._id;
    expect((await call('connect_websocket', { requestId: metadata })).isError).toBe(true);
    expect(opened).toEqual([]);

    const socketIo = (await models.webSocketRequest.create({ parentId: workspaceId, name: 'IO', url: 'ws://localhost:4010/socket.io/', socketIo: { enabled: true, namespace: '/', event: 'chat' } } as any))._id;
    open.add(socketIo);
    expect((await call('send_websocket_message', { requestId: socketIo, message: 'x' })).body.error).toMatch(/Socket.IO or MQTT/);
    expect(await call('connect_websocket', { requestId: 'ws-req_nope' })).toEqual({ body: { error: 'WebSocket request not found' }, isError: true });
  });
});
