import { StringDecoder } from 'node:string_decoder';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { database } from '../../../common/database';
import { auditStoredResponse } from '../../../common/response-audit';
import * as models from '../../../models';
import type { GrpcRequest } from '../../../models/grpc-request';
import * as requestOperations from '../../../models/helpers/request-operations';
import type { McpRequest } from '../../../models/mcp-request';
import type { Request } from '../../../models/request';
import type { WebSocketRequest } from '../../../models/websocket-request';
import { fail, json, notFound, redactSecrets, redactUrl, requestTypeLabel, withoutIgnoredSecurityRules } from './util';

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
    'List all requests in a workspace (across all folders): HTTP, Event Stream, gRPC, WebSocket and MCP.',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const filtered = await database.findDescendants<Request | GrpcRequest | WebSocketRequest | McpRequest>(workspaceId, [
        models.request.type,
        models.grpcRequest.type,
        models.webSocketRequest.type,
        models.mcpRequest.type,
      ]);
      return json(filtered.map(r => ({
        id: r._id,
        name: r.name,
        type: requestTypeLabel(r),
        method: 'method' in r ? r.method : undefined,
        url: r.url,
        parentId: r.parentId,
      })));
    },
  );

  server.tool(
    'get_request',
    'Get full details of a request (any type): url, method, headers, body, authentication strategies, parameters, settings.',
    { requestId: z.string() },
    async ({ requestId }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return notFound();
      }
      return json(redactSecrets(req));
    },
  );

  server.tool(
    'list_responses',
    'List recent responses for a request, newest first.',
    { requestId: z.string(), limit: z.number().int().min(1).max(100).default(10) },
    async ({ requestId, limit }) => {
      const responses = await models.response.findByParentId(requestId);
      const sorted = responses.sort((a, b) => b.created - a.created).slice(0, limit);
      return json(sorted.map(r => ({
        id: r._id,
        statusCode: r.statusCode,
        statusMessage: r.statusMessage,
        elapsedTime: r.elapsedTime,
        created: r.created,
        url: r.url,
        error: r.error,
      })));
    },
  );

  server.tool(
    'get_response',
    'Get a response with body. Body is returned as a UTF-8 string (truncated to a sensible size).',
    { responseId: z.string(), maxBodyBytes: z.number().int().min(1024).max(1_000_000).default(100_000) },
    async ({ responseId, maxBodyBytes }) => {
      const r = await models.response.getById(responseId);
      if (!r) {
        return notFound();
      }
      const { buffer, truncated, fullSize } = await models.response.getBoundedBodyBuffer(r, maxBodyBytes);
      const bodyStr = truncateUtf8(buffer, maxBodyBytes);
      return json({
        id: r._id,
        statusCode: r.statusCode,
        statusMessage: r.statusMessage,
        elapsedTime: r.elapsedTime,
        url: r.url,
        headers: redactSecrets(r.headers),
        error: r.error,
        body: bodyStr,
        bodyTruncated: truncated,
        bodySize: fullSize,
      });
    },
  );

  server.tool(
    'get_last_response',
    'Get the most recent response for a request (with body). Useful after send_http_request.',
    { requestId: z.string(), maxBodyBytes: z.number().int().min(1024).max(1_000_000).default(100_000) },
    async ({ requestId, maxBodyBytes }) => {
      const responses = await models.response.findByParentId(requestId);
      if (responses.length === 0) {
        return fail('no responses');
      }
      const latest = responses.sort((a, b) => b.created - a.created)[0];
      const { buffer, truncated, fullSize } = await models.response.getBoundedBodyBuffer(latest, maxBodyBytes);
      const bodyStr = truncateUtf8(buffer, maxBodyBytes);
      return json({
        id: latest._id,
        statusCode: latest.statusCode,
        statusMessage: latest.statusMessage,
        elapsedTime: latest.elapsedTime,
        url: latest.url,
        headers: redactSecrets(latest.headers),
        error: latest.error,
        body: bodyStr,
        bodyTruncated: truncated,
        bodySize: fullSize,
      });
    },
  );

  server.tool(
    'audit_response',
    "What a response says about the security of the API that sent it, as the response pane's Security tab shows: plain http, weak TLS, credentials in the URL, unsigned or unexpiring JWTs, missing security headers, cookie flags, CORS, version headers, stack traces and sensitive-looking fields. Each finding has a severity (high, medium, low, info) and the OWASP API Security Top 10 risk it comes under. It reads the stored exchange and sends nothing, so it can't show what takes trying the API (authorization between users, rate limits). Rules the collection ignores in the Security tab are left out, and named in ignoredRules. Give a responseId, or a requestId for its most recent response.",
    { responseId: z.string().optional(), requestId: z.string().optional() },
    async ({ responseId, requestId }) => {
      if (!responseId && !requestId) {
        return fail('give a responseId or a requestId');
      }
      const response = responseId
        ? await models.response.getById(responseId)
        : (await models.response.findByParentId(requestId!)).sort((a, b) => b.created - a.created)[0];
      if (!response) {
        return responseId ? notFound() : fail('no responses');
      }
      if (response.error || !response.statusCode) {
        return fail('the request got no response to audit');
      }
      const shown = await withoutIgnoredSecurityRules(response.parentId, await auditStoredResponse(response));
      return json({ responseId: response._id, url: redactUrl(response.url), statusCode: response.statusCode, ...shown });
    },
  );
}
