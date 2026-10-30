import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { version } from '../../../../package.json';
import { CONTENT_TYPE_EVENT_STREAM, CONTENT_TYPE_GRAPHQL, CONTENT_TYPE_JSON, METHOD_GET, METHOD_POST } from '../../../common/constants';
import * as models from '../../../models';
import * as requestOperations from '../../../models/helpers/request-operations';
import { findWorkspaceForRequest, requestTypeLabel } from './util';

// the types the app's New menu makes, made as it makes them
const REQUEST_TYPES = ['HTTP', 'GraphQL', 'Event Stream', 'gRPC', 'WebSocket', 'MCP'] as const;
const userAgent = { name: 'User-Agent', value: `insomnium/${version}` };

export function registerRequestMutationTools(server: McpServer) {
  server.tool(
    'update_request',
    'Patch fields on an existing request (HTTP/gRPC/WebSocket/MCP). The patch is a partial of the request shape: e.g. {url, method, body, headers, authentication, metadata, parameters, name, parentId (a folder or workspace to move it to)}. Read get_request first to see the current shape.',
    {
      requestId: z.string(),
      patch: z.record(z.string(), z.any()),
    },
    async ({ requestId, patch }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      // Drop identity/bookkeeping fields rather than corrupt the doc.
      const safePatch = { ...patch };
      for (const k of ['_id', 'type', 'created', 'modified']) {
        delete safePatch[k];
      }
      await requestOperations.update(req as any, safePatch);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, requestId }) }] };
    },
  );

  server.tool(
    'create_request',
    "Create a new request in a workspace or folder. parentId can be a workspaceId or a requestGroupId. type is one of HTTP; GraphQL (an HTTP POST with a GraphQL body: set the query with update_request's body.text); Event Stream (an HTTP GET that accepts text/event-stream, for server-sent events); gRPC; WebSocket; MCP (a connection to an MCP server's streamable HTTP url).",
    {
      parentId: z.string(),
      type: z.enum(REQUEST_TYPES),
      name: z.string().optional(),
      url: z.string().default(''),
      method: z.string().optional(),
    },
    async ({ parentId, type, name, url, method }) => {
      let created;
      if (type === 'HTTP') {
        created = await models.request.create({ parentId, name: name || 'New Request', url, method: (method || METHOD_GET).toUpperCase(), headers: [userAgent] });
      } else if (type === 'GraphQL') {
        created = await models.request.create({
          parentId, name: name || 'New Request', url, method: (method || METHOD_POST).toUpperCase(),
          headers: [userAgent, { name: 'Content-Type', value: CONTENT_TYPE_JSON }],
          body: { mimeType: CONTENT_TYPE_GRAPHQL, text: '' },
        });
      } else if (type === 'Event Stream') {
        created = await models.request.create({
          parentId, name: name || 'New Event Stream', url, method: (method || METHOD_GET).toUpperCase(),
          headers: [userAgent, { name: 'Accept', value: CONTENT_TYPE_EVENT_STREAM }],
        });
      } else if (type === 'gRPC') {
        created = await models.grpcRequest.create({ parentId, name: name || 'New Request', url });
      } else if (type === 'WebSocket') {
        created = await models.webSocketRequest.create({ parentId, name: name || 'New WebSocket Request', url, headers: [userAgent] });
      } else {
        // over HTTP only: a stdio one runs a command on this computer when it connects
        created = await models.mcpRequest.create({ parentId, name: name || 'New MCP Request', transport: 'http', url });
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
    'duplicate_request',
    'Copy a request (any type) with its settings, but not its responses, next to it or into another folder or workspace (parentId). The copy is named "<name> (Copy)" unless name is given.',
    { requestId: z.string(), name: z.string().optional(), parentId: z.string().optional() },
    async ({ requestId, name, parentId }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      if (parentId && !await findWorkspaceForRequest(parentId)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'parentId is not a workspace or folder' }) }], isError: true };
      }
      const copy = await requestOperations.duplicate(req, { ...(name ? { name } : {}), ...(parentId ? { parentId } : {}) });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, id: copy._id, type: requestTypeLabel(copy), name: copy.name, parentId: copy.parentId }) }] };
    },
  );

  server.tool(
    'delete_request',
    'Delete a request (and its responses). This cannot be undone.',
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
    'Return the type label (HTTP / Event Stream / gRPC / WebSocket / MCP) for a request id.',
    { requestId: z.string() },
    async ({ requestId }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ id: requestId, type: requestTypeLabel(req) }) }] };
    },
  );
}
