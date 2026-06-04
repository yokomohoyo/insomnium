import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as models from '../../../models';
import { isGrpcRequest } from '../../../models/grpc-request';
import * as requestOperations from '../../../models/helpers/request-operations';
import { isRequest } from '../../../models/request';
import { isWebSocketRequest } from '../../../models/websocket-request';

export function registerRequestMutationTools(server: McpServer) {
  server.tool(
    'update_request',
    'Patch fields on an existing request (HTTP/gRPC/WebSocket). The patch is a partial of the request shape: e.g. {url, method, body, headers, authentication, metadata, parameters, name}. Read get_request first to see the current shape.',
    {
      requestId: z.string(),
      patch: z.record(z.string(), z.any()),
    },
    async ({ requestId, patch }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      await requestOperations.update(req as any, patch);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, requestId }) }] };
    },
  );

  server.tool(
    'create_request',
    'Create a new request in a workspace or folder. parentId can be a workspaceId or a requestGroupId. type is one of HTTP, gRPC, WebSocket.',
    {
      parentId: z.string(),
      type: z.enum(['HTTP', 'gRPC', 'WebSocket']),
      name: z.string().default('New Request'),
      url: z.string().default(''),
      method: z.string().optional(),
    },
    async ({ parentId, type, name, url, method }) => {
      let created;
      if (type === 'HTTP') {
        created = await models.request.create({ parentId, name, url, method: (method || 'GET').toUpperCase() });
      } else if (type === 'gRPC') {
        created = await models.grpcRequest.create({ parentId, name, url });
      } else {
        created = await models.webSocketRequest.create({ parentId, name, url });
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ id: created._id, type, name: created.name, parentId: created.parentId }),
        }],
      };
    },
  );

  server.tool(
    'delete_request',
    'Delete a request (and its responses).',
    { requestId: z.string() },
    async ({ requestId }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      await requestOperations.remove(req as any);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, requestId }) }] };
    },
  );

  server.tool(
    'get_request_type',
    'Return the type label (HTTP / gRPC / WebSocket) for a request id.',
    { requestId: z.string() },
    async ({ requestId }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      const t = isGrpcRequest(req) ? 'gRPC' : isWebSocketRequest(req) ? 'WebSocket' : isRequest(req) ? 'HTTP' : 'unknown';
      return { content: [{ type: 'text', text: JSON.stringify({ id: requestId, type: t }) }] };
    },
  );
}
