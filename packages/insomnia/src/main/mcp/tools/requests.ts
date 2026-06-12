import { StringDecoder } from 'node:string_decoder';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { database } from '../../../common/database';
import * as models from '../../../models';
import * as requestOperations from '../../../models/helpers/request-operations';
import type { GrpcRequest } from '../../../models/grpc-request';
import { isGrpcRequest } from '../../../models/grpc-request';
import type { Request } from '../../../models/request';
import type { WebSocketRequest } from '../../../models/websocket-request';
import { isWebSocketRequest } from '../../../models/websocket-request';
import { redactSecrets } from './util';

// Byte-capped decode that drops a trailing split multibyte sequence.
function truncateUtf8(body: string | Buffer | null | undefined, maxBytes: number): string {
  if (body == null) {
    return '';
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return new StringDecoder('utf8').write(buf.subarray(0, maxBytes));
}

export function registerRequestTools(server: McpServer) {
  server.tool(
    'list_requests',
    'List all HTTP/gRPC/WebSocket requests in a workspace (across all folders).',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const filtered = await database.findDescendants<Request | GrpcRequest | WebSocketRequest>(workspaceId, [
        models.request.type,
        models.grpcRequest.type,
        models.webSocketRequest.type,
      ]);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            filtered.map(r => ({
              id: r._id,
              name: r.name,
              type: isGrpcRequest(r) ? 'gRPC' : isWebSocketRequest(r) ? 'WebSocket' : 'HTTP',
              method: 'method' in r ? r.method : undefined,
              url: r.url,
              parentId: r.parentId,
            })),
            null,
            2,
          ),
        }],
      };
    },
  );

  server.tool(
    'get_request',
    'Get full details of a request (any type): url, method, headers, body, authentication strategies, parameters, settings.',
    { requestId: z.string() },
    async ({ requestId }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(redactSecrets(req), null, 2) }] };
    },
  );

  server.tool(
    'list_responses',
    'List recent responses for a request, newest first.',
    { requestId: z.string(), limit: z.number().int().min(1).max(100).default(10) },
    async ({ requestId, limit }) => {
      const responses = await models.response.findByParentId(requestId);
      const sorted = responses.sort((a, b) => b.created - a.created).slice(0, limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            sorted.map(r => ({
              id: r._id,
              statusCode: r.statusCode,
              statusMessage: r.statusMessage,
              elapsedTime: r.elapsedTime,
              created: r.created,
              url: r.url,
              error: r.error,
            })),
            null,
            2,
          ),
        }],
      };
    },
  );

  server.tool(
    'get_response',
    'Get a response with body. Body is returned as a UTF-8 string (truncated to a sensible size).',
    { responseId: z.string(), maxBodyBytes: z.number().int().min(1024).max(1_000_000).default(100_000) },
    async ({ responseId, maxBodyBytes }) => {
      const r = await models.response.getById(responseId);
      if (!r) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      const { buffer, truncated, fullSize } = await models.response.getBoundedBodyBuffer(r, maxBodyBytes);
      const bodyStr = truncateUtf8(buffer, maxBodyBytes);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: r._id,
            statusCode: r.statusCode,
            statusMessage: r.statusMessage,
            elapsedTime: r.elapsedTime,
            url: r.url,
            headers: r.headers,
            error: r.error,
            body: bodyStr,
            bodyTruncated: truncated,
            bodySize: fullSize,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_last_response',
    'Get the most recent response for a request (with body). Useful after send_http_request.',
    { requestId: z.string(), maxBodyBytes: z.number().int().min(1024).max(1_000_000).default(100_000) },
    async ({ requestId, maxBodyBytes }) => {
      const responses = await models.response.findByParentId(requestId);
      if (responses.length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'no responses' }) }], isError: true };
      }
      const latest = responses.sort((a, b) => b.created - a.created)[0];
      const { buffer, truncated, fullSize } = await models.response.getBoundedBodyBuffer(latest, maxBodyBytes);
      const bodyStr = truncateUtf8(buffer, maxBodyBytes);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: latest._id,
            statusCode: latest.statusCode,
            statusMessage: latest.statusMessage,
            elapsedTime: latest.elapsedTime,
            url: latest.url,
            headers: latest.headers,
            error: latest.error,
            body: bodyStr,
            bodyTruncated: truncated,
            bodySize: fullSize,
          }, null, 2),
        }],
      };
    },
  );
}
