import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as models from '../../../models';
import { isEventStreamRequest } from '../../../models/request';
import { renderEventStreamConnection } from '../../../network/network';
import type { EventStreamConnection } from '../../network/event-stream-request';
import { assertSafeRequestUrl, findWorkspaceForRequest } from './util';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// what the app's event stream connections (main/network/curl.ts) offer the tools
export interface StreamEvent {
  type: 'open' | 'message' | 'error' | 'close';
  timestamp: number;
  data?: string;
  message?: string;
  statusCode?: number;
  reason?: string;
}
export interface EventStreamControls {
  open: (options: EventStreamConnection & { requestId: string; workspaceId: string }) => Promise<void>;
  close: (requestId: string) => void;
  isOpen: (requestId: string) => Promise<boolean>;
  events: (responseId: string) => Promise<StreamEvent[]>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The app's only: an event stream (SSE) request's connection, as its Connect
// button opens it, so the window shows the same connection and messages
export function registerStreamTools(server: McpServer, streams: EventStreamControls, { waitMs = 3000 } = {}) {
  const findStream = async (requestId: string) => {
    const request = await models.request.getById(requestId);
    return request && isEventStreamRequest(request) ? request : null;
  };

  server.tool(
    'connect_event_stream',
    "Connect an event stream (Server-Sent Events) request, as its Connect button does, rendered with the workspace's active environment. It stays open, collecting events, until close_event_stream or the server ends it; read them with read_event_stream. The app's window shows the same connection.",
    { requestId: z.string() },
    async ({ requestId }) => {
      const request = await findStream(requestId);
      if (!request) {
        return text({ error: 'event stream request not found' }, true);
      }
      if (await streams.isOpen(requestId)) {
        return text({ ok: true, open: true, note: 'it was already connected' });
      }
      const workspace = await findWorkspaceForRequest(request.parentId);
      if (!workspace) {
        return text({ error: "the request's workspace was not found" }, true);
      }
      const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
      const environmentId = meta.activeEnvironmentId || (await models.environment.getOrCreateForParentId(workspace._id))._id;
      let connection: EventStreamConnection;
      try {
        connection = await renderEventStreamConnection(request, environmentId);
        assertSafeRequestUrl(connection.url);
      } catch (err) {
        return text({ error: (err as Error).message }, true);
      }
      await streams.open({ ...connection, requestId, workspaceId: workspace._id });
      // the connection reports itself open once the server answers
      for (let waited = 0; waited < waitMs && !await streams.isOpen(requestId); waited += 100) {
        await sleep(100);
      }
      const open = await streams.isOpen(requestId);
      return text({ ok: open, open, ...(open ? {} : { note: 'not open yet, or the server refused: read_event_stream shows what happened' }) }, !open);
    },
  );

  server.tool(
    'read_event_stream',
    "The events an event stream request's latest connection received, newest first: each message's data, and the open, error and close events. Says whether it's still connected.",
    { requestId: z.string(), limit: z.number().int().min(1).max(500).default(50) },
    async ({ requestId, limit }) => {
      if (!await findStream(requestId)) {
        return text({ error: 'event stream request not found' }, true);
      }
      const meta = await models.requestMeta.getByParentId(requestId);
      const events = meta?.activeResponseId ? await streams.events(meta.activeResponseId) : [];
      return text({
        open: await streams.isOpen(requestId),
        total: events.length,
        events: events.slice(0, limit).map(({ type, timestamp, data, message, statusCode, reason }) => ({
          type,
          time: new Date(timestamp).toISOString(),
          ...(data !== undefined ? { data } : {}),
          ...(message !== undefined ? { message } : {}),
          ...(type === 'close' ? { statusCode, reason } : {}),
        })),
      });
    },
  );

  server.tool(
    'close_event_stream',
    "Close an event stream request's connection.",
    { requestId: z.string() },
    async ({ requestId }) => {
      const wasOpen = await streams.isOpen(requestId);
      streams.close(requestId);
      return text({ ok: true, wasOpen });
    },
  );
}
