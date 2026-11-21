import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerRequestMutationTools } from '../mutate-requests';
import { registerRequestTools } from '../requests';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
const server = { tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any;
registerRequestTools(server);
registerRequestMutationTools(server);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the request tools', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
  });

  it("make every type the app's New menu makes, as it makes them", async () => {
    const make = async (type: string, url = 'https://shop.example.com') => (await call('create_request', { parentId: workspaceId, type, url })).body;

    const graphql = await make('GraphQL');
    expect(await models.request.getById(graphql.id)).toMatchObject({ method: 'POST', body: { mimeType: 'application/graphql', text: '' } });

    const events = await make('Event Stream');
    expect(events).toMatchObject({ type: 'Event Stream', name: 'New Event Stream' });
    expect((await models.request.getById(events.id))?.headers).toContainEqual({ name: 'Accept', value: 'text/event-stream' });

    const mcp = await make('MCP', 'https://mcp.example.com/mcp');
    expect(await models.mcpRequest.getById(mcp.id)).toMatchObject({ transport: 'http', url: 'https://mcp.example.com/mcp', name: 'New MCP Request' });

    const http = await make('HTTP');
    expect(await models.request.getById(http.id)).toMatchObject({ method: 'GET' });
    await make('WebSocket', 'wss://shop.example.com');
    await make('gRPC', 'grpc.example.com:443');

    // all of them listed, each with its type
    const listed = (await call('list_requests', { workspaceId })).body;
    expect(listed.map((request: { type: string }) => request.type).sort()).toEqual(['Event Stream', 'HTTP', 'HTTP', 'MCP', 'WebSocket', 'gRPC']);
    expect((await call('get_request_type', { requestId: mcp.id })).body).toEqual({ id: mcp.id, type: 'MCP' });
    expect((await call('get_request_type', { requestId: events.id })).body).toEqual({ id: events.id, type: 'Event Stream' });
  });

  it('copy a request, beside it or into a folder', async () => {
    const folderId = (await models.requestGroup.create({ parentId: workspaceId, name: 'Orders' }))._id;
    const original = await models.request.create({ parentId: workspaceId, name: 'List', url: 'https://shop.example.com/orders', method: 'GET' });

    const beside = (await call('duplicate_request', { requestId: original._id })).body;
    expect(beside).toMatchObject({ ok: true, type: 'HTTP', name: 'List (Copy)', parentId: workspaceId });
    expect(await models.request.getById(beside.id)).toMatchObject({ url: 'https://shop.example.com/orders' });

    const moved = (await call('duplicate_request', { requestId: original._id, name: 'List again', parentId: folderId })).body;
    expect(moved).toMatchObject({ name: 'List again', parentId: folderId });

    const mcp = await models.mcpRequest.create({ parentId: workspaceId, name: 'Tools', url: 'https://mcp.example.com/mcp' });
    expect((await call('duplicate_request', { requestId: mcp._id })).body).toMatchObject({ type: 'MCP', name: 'Tools (Copy)' });

    expect(await call('duplicate_request', { requestId: 'req_nope' })).toEqual({ body: { error: 'not found' }, isError: true });
    expect(await call('duplicate_request', { requestId: original._id, parentId: 'fld_nope' })).toEqual({ body: { error: 'parentId is not a workspace or folder' }, isError: true });
  });

  it("audit a request's latest response, or one by id, and send nothing", async () => {
    const request = await models.request.create({ parentId: workspaceId, name: 'List', url: 'http://shop.example.com/orders' });
    const kept = (patch: object) => models.response.create({
      parentId: request._id,
      statusCode: 200,
      contentType: 'application/json',
      headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Content-Type-Options', value: 'nosniff' }],
      ...patch,
    });
    const earlier = await kept({ url: 'http://shop.example.com/orders?api_key=s3cret', created: 1 });
    const latest = await kept({ url: 'https://localhost:8443/orders', created: 2 });

    expect((await call('audit_response', { requestId: request._id })).body).toEqual({ responseId: latest._id, url: 'https://localhost:8443/orders', statusCode: 200, findings: [] });

    const { body, isError } = await call('audit_response', { responseId: earlier._id });
    expect(isError).toBe(false);
    expect(body.findings.map((finding: { id: string }) => finding.id)).toEqual(['plain-http', 'secret-in-url']);
    expect(body.findings[0]).toEqual({ id: 'plain-http', severity: 'medium', owasp: 'API8:2023 Security Misconfiguration', title: 'Sent over plain HTTP', detail: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('s3cret');
  });

  it('refuse to audit what has no response', async () => {
    const request = await models.request.create({ parentId: workspaceId, name: 'List', url: 'https://shop.example.com/orders' });
    expect(await call('audit_response', {})).toEqual({ body: { error: 'give a responseId or a requestId' }, isError: true });
    expect(await call('audit_response', { requestId: request._id })).toEqual({ body: { error: 'no responses' }, isError: true });
    expect(await call('audit_response', { responseId: 'res_nope' })).toEqual({ body: { error: 'not found' }, isError: true });

    const failed = await models.response.create({ parentId: request._id, error: 'Could not resolve host', statusCode: 0 });
    expect(await call('audit_response', { responseId: failed._id })).toEqual({ body: { error: 'the request got no response to audit' }, isError: true });
  });
});
