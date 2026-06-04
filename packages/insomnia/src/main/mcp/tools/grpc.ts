import { credentials, makeGenericClientConstructor, Metadata } from '@grpc/grpc-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getRenderedGrpcRequest, RENDER_PURPOSE_SEND } from '../../../common/render';
import * as models from '../../../models';
import { isGrpcRequest } from '../../../models/grpc-request';
import { getAuthHeaders } from '../../../network/authentication';
import { parseGrpcUrl } from '../../../network/grpc/parse-grpc-url';
import { getMethodType, getSelectedMethod } from '../../ipc/grpc';

export function registerGrpcTools(server: McpServer) {
  server.tool(
    'send_grpc_request',
    'Send a gRPC request and return responses. Supports all four method types:\n' +
      '- unary: uses the request body\n' +
      '- server-streaming: uses the request body, returns up to maxResponses messages or until the stream ends / timeoutMs elapses\n' +
      '- client-streaming: requires `messages` (array of JSON bodies); returns the single response\n' +
      '- bidi: requires `messages`; returns up to maxResponses response messages collected from the stream',
    {
      requestId: z.string(),
      environmentId: z.string().nullable().optional(),
      protoMethodName: z.string().optional().describe('Override request.protoMethodName for this call. Format: /<package>.<Service>/<Method>'),
      timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
      maxResponses: z.number().int().min(1).max(1000).default(50).describe('Cap on collected messages for server-streaming and bidi methods.'),
      messages: z.array(z.record(z.string(), z.any())).optional().describe('Required for client-streaming and bidi. Each element is a request message body (JSON object).'),
    },
    async args => {
      try {
        return await sendGrpcInner(args);
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (err as Error).message || String(err), stack: (err as Error).stack }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'update_grpc_metadata',
    'Replace the metadata (header) list on a gRPC request. Pass the full new list - each entry is {name, value, disabled?}.',
    {
      requestId: z.string(),
      metadata: z.array(z.object({
        name: z.string(),
        value: z.string(),
        disabled: z.boolean().optional(),
        description: z.string().optional(),
      })),
    },
    async ({ requestId, metadata }) => {
      const req = await models.grpcRequest.getById(requestId);
      if (!req || !isGrpcRequest(req)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'gRPC request not found' }) }], isError: true };
      }
      await models.grpcRequest.update(req, { metadata });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, requestId, entries: metadata.length }) }] };
    },
  );
}

interface SendGrpcArgs {
  requestId: string;
  environmentId?: string | null;
  protoMethodName?: string;
  timeoutMs: number;
  maxResponses: number;
  messages?: Record<string, any>[];
}

async function sendGrpcInner({ requestId, environmentId, protoMethodName, timeoutMs, maxResponses, messages }: SendGrpcArgs): Promise<any> {
  const req = await models.grpcRequest.getById(requestId);
  if (!req || !isGrpcRequest(req)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'gRPC request not found' }) }], isError: true };
  }
  let envId: string | null | undefined = environmentId;
  if (envId === undefined) {
    const meta = await models.workspaceMeta.getOrCreateByParentId(req.parentId);
    envId = meta.activeEnvironmentId;
  }
  const rendered = await getRenderedGrpcRequest({
    request: req,
    environmentId: envId || '',
    purpose: RENDER_PURPOSE_SEND,
  });
  if (protoMethodName) {
    (rendered as any).protoMethodName = protoMethodName;
  }
  const method = await getSelectedMethod(rendered as any);
  if (!method) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `method ${rendered.protoMethodName} not found - set protoFileId on the request, or ensure server reflection is enabled` }) }], isError: true };
  }
  const methodType = getMethodType(method);
  const { url, enableTls } = parseGrpcUrl(rendered.url);
  if (!url) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'URL not specified' }) }], isError: true };
  }

  // Mirrors buildGrpcMetadata in ipc/grpc.ts.
  const metadata = new Metadata();
  for (const m of (rendered as any).metadata || []) {
    if (!m.disabled && m.name) metadata.add(m.name, m.value || '');
  }
  const authHeaders = await getAuthHeaders(
    { _id: rendered._id, method: '', body: {}, authentication: (rendered as any).authentication } as any,
    rendered.url,
  );
  for (const h of authHeaders) metadata.add(h.name, h.value);

  const needsClientMessages = methodType === 'client' || methodType === 'bidi';
  if (needsClientMessages && (!messages || messages.length === 0)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `method ${method.path} is ${methodType}-streaming; provide \`messages\` array` }) }], isError: true };
  }

  let firstBody: any = undefined;
  if (methodType === 'unary' || methodType === 'server') {
    try {
      firstBody = JSON.parse(rendered.body.text || '{}');
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `invalid JSON body: ${(err as Error).message}` }) }], isError: true };
    }
  }

  // @ts-expect-error second arg empty per existing pattern
  const Client = makeGenericClientConstructor({});
  const client = new Client(url, enableTls ? credentials.createSsl() : credentials.createInsecure());
  const started = Date.now();

  let result: { ok: boolean; response?: any; responses?: any[]; status?: any; error?: any };

  try {
    if (methodType === 'unary') {
      result = await new Promise(resolve => {
        client.makeUnaryRequest(
          method.path,
          method.requestSerialize,
          method.responseDeserialize,
          firstBody,
          metadata,
          { deadline: Date.now() + timeoutMs },
          (err: any, response: any) => {
            if (err) resolve({ ok: false, error: { code: err.code, details: err.details, message: err.message } });
            else resolve({ ok: true, response });
          },
        );
      });
    } else if (methodType === 'server') {
      result = await new Promise(resolve => {
        const responses: any[] = [];
        const call = client.makeServerStreamRequest(
          method.path,
          method.requestSerialize,
          method.responseDeserialize,
          firstBody,
          metadata,
          { deadline: Date.now() + timeoutMs },
        );
        const cap = () => {
          if (responses.length >= maxResponses) {
            try {
              call.cancel();
            } catch { /* noop */ }
          }
        };
        call.on('data', (msg: any) => { responses.push(msg); cap(); });
        call.on('end', () => resolve({ ok: true, responses }));
        call.on('error', (err: any) => {
          // code 1 = CANCELLED - our own cancel after maxResponses.
          if (err?.code === 1 && responses.length >= maxResponses) {
            resolve({ ok: true, responses, status: { truncated: true } });
            return;
          }
          resolve({ ok: false, error: { code: err.code, details: err.details, message: err.message }, responses });
        });
      });
    } else if (methodType === 'client') {
      result = await new Promise(resolve => {
        const call = client.makeClientStreamRequest(
          method.path,
          method.requestSerialize,
          method.responseDeserialize,
          metadata,
          { deadline: Date.now() + timeoutMs },
          (err: any, response: any) => {
            if (err) resolve({ ok: false, error: { code: err.code, details: err.details, message: err.message } });
            else resolve({ ok: true, response });
          },
        );
        for (const m of messages!) (call as any).write(m);
        (call as any).end();
      });
    } else { // bidi
      result = await new Promise(resolve => {
        const responses: any[] = [];
        const call = client.makeBidiStreamRequest(
          method.path,
          method.requestSerialize,
          method.responseDeserialize,
          metadata,
          { deadline: Date.now() + timeoutMs },
        );
        const cap = () => {
          if (responses.length >= maxResponses) {
            try {
              (call as any).cancel();
            } catch { /* noop */ }
          }
        };
        (call as any).on('data', (msg: any) => { responses.push(msg); cap(); });
        (call as any).on('end', () => resolve({ ok: true, responses }));
        (call as any).on('error', (err: any) => {
          if (err?.code === 1 && responses.length >= maxResponses) {
            resolve({ ok: true, responses, status: { truncated: true } });
            return;
          }
          resolve({ ok: false, error: { code: err.code, details: err.details, message: err.message }, responses });
        });
        for (const m of messages!) (call as any).write(m);
        (call as any).end();
      });
    }
  } finally {
    try {
      client.close?.();
    } catch { /* noop */ }
  }

  const elapsedMs = Date.now() - started;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: result.ok,
        methodType,
        method: method.path,
        url,
        tls: enableTls,
        elapsedMs,
        response: result.response,
        responses: result.responses,
        responseCount: result.responses?.length,
        truncated: result.status?.truncated || false,
        error: result.error,
      }, null, 2),
    }],
    isError: !result.ok,
  };
}
