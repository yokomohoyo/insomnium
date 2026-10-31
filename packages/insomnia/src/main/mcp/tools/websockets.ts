import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getRenderContext, render, RENDER_PURPOSE_SEND } from '../../../common/render';
import * as models from '../../../models';
import { type WebSocketConnection, renderWebSocketConnection } from '../../../network/websocket-connect';
import type { webSockets } from '../../network/websocket';
import { assertSafeRequestUrl, findWorkspaceForRequest } from './util';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// what the app's WebSocket connections (main/network/websocket.ts) offer the
// tools: a type only, so nothing of Electron's comes with it
export type WebSocketControls = typeof webSockets;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The app's only: a WebSocket request's connection, as its Connect button opens
// it (a plain socket, a GraphQL subscription, Socket.IO or MQTT, as the
// request is set up), so the window shows the same connection and messages
export function registerWebSocketTools(server: McpServer, sockets: WebSocketControls, { waitMs = 3000 } = {}) {
  const contextOf = async (requestId: string) => {
    const request = await models.webSocketRequest.getById(requestId);
    if (!request) {
      return null;
    }
    const workspace = await findWorkspaceForRequest(request.parentId);
    if (!workspace) {
      return null;
    }
    const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
    const environmentId = meta.activeEnvironmentId || (await models.environment.getOrCreateForParentId(workspace._id))._id;
    return { request, workspace, environmentId };
  };

  server.tool(
    'connect_websocket',
    "Connect a WebSocket request, as its Connect button does, rendered with the workspace's active environment: a plain socket, or a GraphQL subscription, Socket.IO or MQTT as the request is set up. It stays open, collecting messages, until close_websocket or the server closes it; send with send_websocket_message and read with read_websocket_messages. The app's window shows the same connection.",
    { requestId: z.string() },
    async ({ requestId }) => {
      const context = await contextOf(requestId);
      if (!context) {
        return text({ error: 'WebSocket request not found' }, true);
      }
      if (await sockets.isOpen(requestId)) {
        return text({ ok: true, open: true, note: 'it was already connected' });
      }
      let connection: WebSocketConnection;
      try {
        connection = await renderWebSocketConnection(context.request, context.environmentId, context.workspace._id);
        assertSafeRequestUrl(connection.url, ['ws:', 'wss:']);
      } catch (err) {
        return text({ error: (err as Error).message }, true);
      }
      await sockets.open({ ...connection, requestId, workspaceId: context.workspace._id });
      for (let waited = 0; waited < waitMs && !await sockets.isOpen(requestId); waited += 100) {
        await sleep(100);
      }
      const open = await sockets.isOpen(requestId);
      return text({ ok: open, open, ...(open ? {} : { note: 'not open yet, or the server refused: read_websocket_messages shows what happened' }) }, !open);
    },
  );

  server.tool(
    'send_websocket_message',
    "Send a message on a connected WebSocket request, its templates rendered with the active environment. binary sends it as a binary frame, the message being hex or base64. For Socket.IO or MQTT requests, use the app's message editor (an event name or topic goes with each).",
    { requestId: z.string(), message: z.string(), binary: z.enum(['hex', 'base64']).optional() },
    async ({ requestId, message, binary }) => {
      const context = await contextOf(requestId);
      if (!context) {
        return text({ error: 'WebSocket request not found' }, true);
      }
      if (context.request.socketIo?.enabled || context.request.mqtt?.enabled) {
        return text({ error: "this request speaks Socket.IO or MQTT: send from the app's message editor, which sets the event or topic" }, true);
      }
      if (!await sockets.isOpen(requestId)) {
        return text({ error: 'not connected: connect_websocket first' }, true);
      }
      let payload: string;
      try {
        payload = await render(message, await getRenderContext({ request: context.request, environmentId: context.environmentId, purpose: RENDER_PURPOSE_SEND })) as string;
        await sockets.send({ requestId, payload, ...(binary ? { binary } : {}) });
      } catch (err) {
        return text({ error: (err as Error).message }, true);
      }
      return text({ ok: true });
    },
  );

  server.tool(
    'read_websocket_messages',
    "The messages and events a WebSocket request's latest connection had, newest first: each message's direction (INCOMING or OUTGOING) and data, and the open, error and close events. Says whether it's still connected.",
    { requestId: z.string(), limit: z.number().int().min(1).max(500).default(50) },
    async ({ requestId, limit }) => {
      if (!await models.webSocketRequest.getById(requestId)) {
        return text({ error: 'WebSocket request not found' }, true);
      }
      const events = await sockets.events(requestId);
      return text({
        open: await sockets.isOpen(requestId),
        total: events.length,
        events: events.slice(0, limit).map(event => {
          const { type, timestamp, direction, data, message, code, reason } = event as { type: string; timestamp: number; direction?: string; data?: unknown; message?: string; code?: number; reason?: string };
          return {
            type,
            time: new Date(timestamp).toISOString(),
            ...(direction ? { direction } : {}),
            ...(data !== undefined ? { data } : {}),
            ...(message !== undefined ? { message } : {}),
            ...(type === 'close' ? { code, reason } : {}),
          };
        }),
      });
    },
  );

  server.tool(
    'close_websocket',
    "Close a WebSocket request's connection (and stop any reconnect it's waiting on).",
    { requestId: z.string() },
    async ({ requestId }) => {
      const wasOpen = await sockets.isOpen(requestId);
      sockets.close(requestId);
      return text({ ok: true, wasOpen });
    },
  );
}
