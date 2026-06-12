import { credentials, makeGenericClientConstructor, Metadata } from '@grpc/grpc-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getRenderedGrpcRequest, RENDER_PURPOSE_SEND } from '../../../common/render';
import * as models from '../../../models';
import { isGrpcRequest } from '../../../models/grpc-request';
import { getAuthHeaders } from '../../../network/authentication';
import { parseGrpcUrl } from '../../../network/grpc/parse-grpc-url';
import { getMethodType, getSelectedMethod } from '../../ipc/grpc';
import { assertSafeHeaders, findWorkspaceForRequest } from './util';

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
        // Don't return err.stack - it leaks absolute paths (username/install layout).
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (err as Error).message || String(err) }) }],
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

interface GrpcResult {
  ok: boolean;
  response?: any;
  responses?: any[];
  status?: any;
  error?: any;
}

// Settle a gRPC call exactly once, with a backstop timer so a server that goes
// silent after cancel()/deadline can't hang the request and leak the client.
function settleWithBackstop(
  timeoutMs: number,
  onBackstop: () => GrpcResult,
  executor: (settle: (value: GrpcResult) => void) => void,
): Promise<GrpcResult> {
  return new Promise<GrpcResult>((resolve, reject) => {
    let settled = false;
    const settle = (value: GrpcResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => settle(onBackstop()), timeoutMs + 2000);
    timer.unref?.();
    try {
      executor(settle);
    } catch (err) {
      // A synchronous executor throw (e.g. call.write/end) would leave the timer
      // armed; clear it and reject so the caller's finally{ client.close() } runs.
      settled = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

async function sendGrpcInner({ requestId, environmentId, protoMethodName, timeoutMs, maxResponses, messages }: SendGrpcArgs): Promise<any> {
  const req = await models.grpcRequest.getById(requestId);
  if (!req || !isGrpcRequest(req)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'gRPC request not found' }) }], isError: true };
  }
  let envId: string | null | undefined = environmentId;
  if (envId === undefined) {
    // WorkspaceMeta is keyed by workspace id; a folder id would mint a junk meta doc.
    const workspace = await findWorkspaceForRequest(req.parentId);
    if (workspace) {
      const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
      envId = meta.activeEnvironmentId;
    }
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

  // gRPC has no HTTP method/body: only header-emitting strategies work here;
  // signature-based ones (Hawk, OAuth 1) would sign garbage.
  const authHeaders = await getAuthHeaders(
    { _id: rendered._id, method: '', body: {}, authentication: (rendered as any).authentication } as any,
    rendered.url,
  );
  // Mirrors buildGrpcMetadata in ipc/grpc.ts. Validate before adding so a
  // model-supplied metadata name/value can't smuggle a CR/LF (header injection).
  const metaEntries = [
    ...((rendered as any).metadata || []).map((m: any) => ({ name: m.name, value: m.value || '', disabled: m.disabled })),
    ...authHeaders.map(h => ({ name: h.name, value: h.value })),
  ];
  assertSafeHeaders(metaEntries);
  const metadata = new Metadata();
  for (const e of metaEntries) {
    if (!e.disabled && e.name) metadata.add(e.name, e.value);
  }

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

  let result: GrpcResult;
  const deadline = Date.now() + timeoutMs;
  const timedOut = (): GrpcResult => ({ ok: false, error: { code: 4, message: `gRPC call exceeded ${timeoutMs}ms with no terminal response` } });

  try {
    if (methodType === 'unary') {
      result = await settleWithBackstop(timeoutMs, timedOut, settle => {
        client.makeUnaryRequest(
          method.path,
          method.requestSerialize,
          method.responseDeserialize,
          firstBody,
          metadata,
          { deadline },
          (err: any, response: any) => {
            if (err) settle({ ok: false, error: { code: err.code, details: err.details, message: err.message } });
            else settle({ ok: true, response });
          },
        );
      });
    } else if (methodType === 'server') {
      const responses: any[] = [];
      result = await settleWithBackstop(timeoutMs,
        () => ({ ok: true, responses, status: { truncated: true, timedOut: true } }),
        settle => {
          const call = client.makeServerStreamRequest(
            method.path,
            method.requestSerialize,
            method.responseDeserialize,
            firstBody,
            metadata,
            { deadline },
          );
          call.on('data', (msg: any) => {
            // cancel() is async; don't let in-flight messages push past the cap.
            if (responses.length >= maxResponses) return;
            responses.push(msg);
            if (responses.length >= maxResponses) {
              try {
                call.cancel();
              } catch { /* noop */ }
              // Settle now (not on the CANCELLED event) so client.close() runs
              // even if the server goes silent.
              settle({ ok: true, responses, status: { truncated: true } });
            }
          });
          call.on('end', () => settle({ ok: true, responses }));
          call.on('error', (err: any) => {
            // code 1 = CANCELLED - our own cancel after maxResponses.
            if (err?.code === 1 && responses.length >= maxResponses) {
              settle({ ok: true, responses, status: { truncated: true } });
              return;
            }
            settle({ ok: false, error: { code: err.code, details: err.details, message: err.message }, responses });
          });
        });
    } else if (methodType === 'client') {
      result = await settleWithBackstop(timeoutMs, timedOut, settle => {
        const call = client.makeClientStreamRequest(
          method.path,
          method.requestSerialize,
          method.responseDeserialize,
          metadata,
          { deadline },
          (err: any, response: any) => {
            if (err) settle({ ok: false, error: { code: err.code, details: err.details, message: err.message } });
            else settle({ ok: true, response });
          },
        );
        for (const m of messages!) (call as any).write(m);
        (call as any).end();
      });
    } else { // bidi
      const responses: any[] = [];
      result = await settleWithBackstop(timeoutMs,
        () => ({ ok: true, responses, status: { truncated: true, timedOut: true } }),
        settle => {
          const call = client.makeBidiStreamRequest(
            method.path,
            method.requestSerialize,
            method.responseDeserialize,
            metadata,
            { deadline },
          );
          (call as any).on('data', (msg: any) => {
            if (responses.length >= maxResponses) return;
            responses.push(msg);
            if (responses.length >= maxResponses) {
              try {
                (call as any).cancel();
              } catch { /* noop */ }
              settle({ ok: true, responses, status: { truncated: true } });
            }
          });
          (call as any).on('end', () => settle({ ok: true, responses }));
          (call as any).on('error', (err: any) => {
            if (err?.code === 1 && responses.length >= maxResponses) {
              settle({ ok: true, responses, status: { truncated: true } });
              return;
            }
            settle({ ok: false, error: { code: err.code, details: err.details, message: err.message }, responses });
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
