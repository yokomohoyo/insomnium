import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import type { McpCallOptions, McpConnectOptions } from '../../../network/mcp-client';
import { type McpRequestControls, registerMcpRequestTools } from '../mcp-requests';

window.app = electron.app;

// the app's MCP client (main/network/mcp-client.ts), without a server
const connected = new Set<string>();
const connects: McpConnectOptions[] = [];
const calls: McpCallOptions[] = [];
const confirmCommand = jest.fn<McpRequestControls['confirmCommand']>();
const controls: McpRequestControls = {
  connect: async options => {
    connects.push(options);
    connected.add(options.requestId);
    return {
      name: 'pets', version: '1.2.3', transport: options.transport === 'stdio' ? 'stdio' : 'streamable-http', instructions: 'Ask about pets',
      tools: [{ name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object' } }], prompts: [], resources: [{ uri: 'pets://all', name: 'all' }],
    };
  },
  call: async options => {
    calls.push(options);
    return { content: [{ type: 'text', text: '3' }] };
  },
  disconnect: async ({ requestId }) => {
    connected.delete(requestId);
  },
  isConnected: ({ requestId }) => connected.has(requestId),
  confirmCommand,
};

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerMcpRequestTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, controls);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the MCP request tools', () => {
  let workspaceId: string;
  let httpId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    connected.clear();
    connects.length = 0;
    calls.length = 0;
    confirmCommand.mockReset();
    workspaceId = (await models.workspace.create({ name: 'Agents' }))._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { host: 'localhost:4010', token: 's3cret' } });
    httpId = (await models.mcpRequest.create({ parentId: workspaceId, name: 'Pets', transport: 'http', url: 'http://{{ host }}/mcp', headers: [{ name: 'Authorization', value: 'Bearer {{ token }}' }, { name: 'X-Off', value: 'x', disabled: true }] } as any))._id;
  });

  it("connects rendered in the environment, lists the server's tools, calls one, and disconnects", async () => {
    const { body } = await call('connect_mcp_server', { requestId: httpId });
    expect(connects[0]).toMatchObject({ requestId: httpId, transport: 'http', url: 'http://localhost:4010/mcp', headers: { Authorization: 'Bearer s3cret' } });
    expect(body).toMatchObject({ ok: true, name: 'pets', instructions: 'Ask about pets', tools: [{ name: 'add', description: 'Adds two numbers' }], resources: [{ uri: 'pets://all' }] });
    expect(confirmCommand).not.toHaveBeenCalled();

    expect(await call('call_mcp_server', { requestId: httpId, kind: 'tool', name: 'add', args: { a: 1, b: 2 } })).toEqual({ body: { content: [{ type: 'text', text: '3' }] }, isError: false });
    await call('call_mcp_server', { requestId: httpId, kind: 'prompt', name: 'greet', args: { name: 7 } });
    await call('call_mcp_server', { requestId: httpId, kind: 'resource', uri: 'pets://all', args: {} });
    expect(calls).toEqual([
      { requestId: httpId, kind: 'tool', name: 'add', args: { a: 1, b: 2 } },
      { requestId: httpId, kind: 'prompt', name: 'greet', args: { name: '7' } },
      { requestId: httpId, kind: 'resource', uri: 'pets://all' },
    ]);
    expect((await call('call_mcp_server', { requestId: httpId, kind: 'resource', args: {} })).body).toEqual({ error: 'a resource needs its uri' });

    expect((await call('disconnect_mcp_server', { requestId: httpId })).body).toEqual({ ok: true, wasConnected: true });
    expect(await call('call_mcp_server', { requestId: httpId, kind: 'tool', name: 'add', args: {} })).toEqual({ body: { error: 'not connected: connect_mcp_server first' }, isError: true });
  });

  it("asks before running a stdio request's command, and runs nothing on a no", async () => {
    const stdioId = (await models.mcpRequest.create({ parentId: workspaceId, name: 'Local', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-everything' } as any))._id;
    confirmCommand.mockResolvedValue(false);
    expect(await call('connect_mcp_server', { requestId: stdioId })).toEqual({ body: { error: 'the user declined to run the command' }, isError: true });
    expect(confirmCommand).toHaveBeenCalledWith({ request: 'Local', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] });
    expect(connects).toEqual([]);

    confirmCommand.mockResolvedValue(true);
    expect((await call('connect_mcp_server', { requestId: stdioId })).body).toMatchObject({ ok: true, transport: 'stdio' });
  });

  it("runs no stdio command with template tags in it, which would run before the user's asked", async () => {
    const tagged = (await models.mcpRequest.create({ parentId: workspaceId, name: 'Tagged', transport: 'stdio', command: 'npx', args: "{% response 'body', 'req_1', '', 'always' %}" } as any))._id;
    expect(await call('connect_mcp_server', { requestId: tagged })).toEqual({ body: { error: "its command has template tags, which an MCP client can't run: connect it in the app" }, isError: true });
    expect(confirmCommand).not.toHaveBeenCalled();
    expect(connects).toEqual([]);
  });

  it('refuses a URL the policy blocks, and a request that is missing', async () => {
    const metadata = (await models.mcpRequest.create({ parentId: workspaceId, name: 'Metadata', transport: 'http', url: 'http://169.254.169.254/mcp' } as any))._id;
    expect((await call('connect_mcp_server', { requestId: metadata })).isError).toBe(true);
    expect(await call('connect_mcp_server', { requestId: 'mcp-req_nope' })).toEqual({ body: { error: 'MCP request not found' }, isError: true });
    expect(connects).toEqual([]);
  });
});
