import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getRenderContext, render, RENDER_PURPOSE_SEND } from '../../../common/render';
import * as models from '../../../models';
import type { RequestHeader } from '../../../models/request';
import { argsOf } from '../../../ui/components/mcp/arguments';
import type { McpCallOptions, McpConnectOptions, McpServerSummary } from '../../network/mcp-client';
import { assertSafeRequestUrl, findWorkspaceForRequest } from './util';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// what the app's MCP client (main/network/mcp-client.ts) offers the tools, and
// the question asked before a request's command runs
export interface McpRequestControls {
  connect: (options: McpConnectOptions) => Promise<McpServerSummary>;
  call: (options: McpCallOptions) => Promise<unknown>;
  disconnect: (options: { requestId: string }) => Promise<void>;
  isConnected: (options: { requestId: string }) => boolean;
  // a stdio request runs a command on this computer: the user says yes first
  confirmCommand: (request: { request: string; command: string; args: string[] }) => Promise<boolean>;
}

const errorText = (err: unknown) => err instanceof Error ? err.message : String(err);

// The app's only: an MCP request's connection to its server, as its Connect
// button opens it, and calls to the server's tools, prompts and resources.
// A command (stdio) is asked about every time, as the app asks.
export function registerMcpRequestTools(server: McpServer, mcp: McpRequestControls) {
  server.tool(
    'connect_mcp_server',
    "Connect an MCP request to its server, as its Connect button does, rendered with the workspace's active environment: over HTTP (streamable, or SSE), or by running its command (stdio), which the app asks the user about every time. Returns the server's name, instructions, and its tools, prompts and resources; call them with call_mcp_server.",
    { requestId: z.string() },
    async ({ requestId }) => {
      const request = await models.mcpRequest.getById(requestId);
      if (!request) {
        return text({ error: 'MCP request not found' }, true);
      }
      const workspace = await findWorkspaceForRequest(request.parentId);
      if (!workspace) {
        return text({ error: "the request's workspace was not found" }, true);
      }
      const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
      const environmentId = meta.activeEnvironmentId || (await models.environment.getOrCreateForParentId(workspace._id))._id;
      let options: McpConnectOptions;
      try {
        const context = await getRenderContext({ request: request as any, environmentId, purpose: RENDER_PURPOSE_SEND });
        const rendered = await render({ url: request.url, headers: request.headers, command: request.command, args: request.args }, context) as { url: string; headers: RequestHeader[]; command: string; args: string };
        options = {
          requestId,
          transport: request.transport,
          url: rendered.url,
          headers: Object.fromEntries(rendered.headers.filter(header => header.name && !header.disabled).map(header => [header.name, header.value])),
          command: rendered.command,
          args: argsOf(rendered.args),
        };
        if (request.transport !== 'stdio') {
          assertSafeRequestUrl(rendered.url);
        }
      } catch (err) {
        return text({ error: errorText(err) }, true);
      }
      if (request.transport === 'stdio') {
        const allowed = await mcp.confirmCommand({ request: request.name, command: options.command || '', args: options.args || [] });
        console.log(`[mcp] connect_mcp_server ${requestId}: the user ${allowed === true ? 'allowed' : 'declined'} its command`);
        if (allowed !== true) {
          return text({ error: 'the user declined to run the command' }, true);
        }
      }
      try {
        const summary = await mcp.connect(options);
        return text({
          ok: true,
          name: summary.name,
          version: summary.version,
          transport: summary.transport,
          ...(summary.instructions ? { instructions: summary.instructions } : {}),
          tools: summary.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
          prompts: summary.prompts.map(prompt => ({ name: prompt.name, description: prompt.description, arguments: prompt.arguments })),
          resources: summary.resources.map(resource => ({ uri: resource.uri, name: resource.name, description: resource.description })),
        });
      } catch (err) {
        return text({ error: errorText(err) }, true);
      }
    },
  );

  server.tool(
    'call_mcp_server',
    "On a connected MCP request (connect_mcp_server), call one of its server's tools (kind tool, name and args), get a prompt (kind prompt, name and string args), or read a resource (kind resource, uri). Returns what the server answered.",
    {
      requestId: z.string(),
      kind: z.enum(['tool', 'prompt', 'resource']),
      name: z.string().optional(),
      uri: z.string().optional(),
      args: z.record(z.string(), z.unknown()).default({}),
    },
    async ({ requestId, kind, name, uri, args }) => {
      if (!mcp.isConnected({ requestId })) {
        return text({ error: 'not connected: connect_mcp_server first' }, true);
      }
      let options: McpCallOptions;
      if (kind === 'resource') {
        if (!uri) {
          return text({ error: 'a resource needs its uri' }, true);
        }
        options = { requestId, kind, uri };
      } else {
        if (!name) {
          return text({ error: `a ${kind} needs its name` }, true);
        }
        options = kind === 'tool'
          ? { requestId, kind, name, args }
          : { requestId, kind, name, args: Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])) };
      }
      try {
        const result = await mcp.call(options) as { isError?: boolean };
        return text(result, result?.isError === true);
      } catch (err) {
        return text({ error: errorText(err) }, true);
      }
    },
  );

  server.tool(
    'disconnect_mcp_server',
    "Disconnect an MCP request from its server (and stop the command a stdio one ran).",
    { requestId: z.string() },
    async ({ requestId }) => {
      const wasConnected = mcp.isConnected({ requestId });
      await mcp.disconnect({ requestId });
      return text({ ok: true, wasConnected });
    },
  );
}
