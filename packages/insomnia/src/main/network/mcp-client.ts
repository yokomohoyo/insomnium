// The MCP client for MCP requests (models/mcp-request.ts): connects to a
// server, lists its tools, prompts and resources, and calls them, one
// connection per request. Over HTTP it tries streamable HTTP, then the older
// SSE transport. Over stdio it runs the request's command, with only the
// environment the SDK passes by default (PATH, HOME and the like), not the
// app's; the app asks before running a command (mcp-request-pane.tsx).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';
import { BrowserWindow, ipcMain } from 'electron';

import { getAppVersion } from '../../common/constants';

export interface McpConnectOptions {
  requestId: string;
  transport: 'http' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
}

export interface McpServerSummary {
  name?: string;
  version?: string;
  instructions?: string;
  // the transport that connected, for a server reached over HTTP
  transport: 'streamable-http' | 'sse' | 'stdio';
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
}

export type McpCallOptions =
  | { requestId: string; kind: 'tool'; name: string; args: Record<string, unknown> }
  | { requestId: string; kind: 'prompt'; name: string; args: Record<string, string> }
  | { requestId: string; kind: 'resource'; uri: string };

const connections = new Map<string, Client>();
// the clients still connecting, so a disconnect can stop one
const connecting = new Map<string, Client>();
const STOPPED = 'Stopped connecting';

const newClient = () => new Client({ name: 'insomnium', version: getAppVersion() });

const summarize = async (client: Client, transport: McpServerSummary['transport']): Promise<McpServerSummary> => {
  const capabilities = client.getServerCapabilities() || {};
  const server = client.getServerVersion();
  const [tools, prompts, resources] = await Promise.all([
    capabilities.tools ? client.listTools().then(result => result.tools) : [],
    capabilities.prompts ? client.listPrompts().then(result => result.prompts) : [],
    capabilities.resources ? client.listResources().then(result => result.resources) : [],
  ]);
  return { name: server?.name, version: server?.version, instructions: client.getInstructions(), transport, tools, prompts, resources };
};

const notifyClosed = (requestId: string) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(`mcpClient.${requestId}.closed`);
  }
};

export async function mcpConnect(options: McpConnectOptions): Promise<McpServerSummary> {
  const { requestId } = options;
  await mcpDisconnect({ requestId });

  const start = () => {
    const client = newClient();
    connecting.set(requestId, client);
    return client;
  };
  let client = start();
  const stopped = () => connecting.get(requestId) !== client;
  let transport: McpServerSummary['transport'];
  try {
    transport = await connectWith(options, () => client, () => {
      if (stopped()) {
        return undefined;
      }
      client = start();
      return client;
    });
  } catch (err) {
    if (stopped()) {
      throw new Error(STOPPED);
    }
    connecting.delete(requestId);
    throw err;
  }
  if (stopped()) {
    await client.close().catch(() => undefined);
    throw new Error(STOPPED);
  }
  connecting.delete(requestId);

  client.onclose = () => {
    if (connections.get(requestId) === client) {
      connections.delete(requestId);
      notifyClosed(requestId);
    }
  };
  connections.set(requestId, client);
  return summarize(client, transport);
}

// Connects the client to the server, by stdio or HTTP (streamable, or else SSE
// for a server from before it, on a new client from again(), which is
// undefined once the connect has been stopped)
async function connectWith(options: McpConnectOptions, current: () => Client, again: () => Client | undefined): Promise<McpServerSummary['transport']> {
  if (options.transport === 'stdio') {
    if (!options.command?.trim()) {
      throw new Error('Enter the command that starts the MCP server');
    }
    await current().connect(new StdioClientTransport({ command: options.command.trim(), args: options.args || [], stderr: 'ignore' }));
    return 'stdio';
  } else {
    let url: URL;
    try {
      url = new URL(options.url || '');
    } catch {
      throw new Error(`Enter the MCP server's http:// or https:// URL, not "${options.url || ''}"`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error("The MCP server's URL has to be http or https");
    }
    const requestInit = { headers: options.headers || {} };
    try {
      await current().connect(new StreamableHTTPClientTransport(url, { requestInit }));
      return 'streamable-http';
    } catch (streamableError) {
      // a server from before streamable HTTP
      const client = again();
      if (!client) {
        throw streamableError;
      }
      try {
        await client.connect(new SSEClientTransport(url, { requestInit, eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: { ...options.headers, ...Object.fromEntries(new Headers(init?.headers).entries()) } }) } }));
        return 'sse';
      } catch {
        throw streamableError;
      }
    }
  }
}

export async function mcpCall(options: McpCallOptions) {
  const client = connections.get(options.requestId);
  if (!client) {
    throw new Error('Not connected: connect to the MCP server first');
  }
  if (options.kind === 'tool') {
    return client.callTool({ name: options.name, arguments: options.args });
  }
  if (options.kind === 'prompt') {
    return client.getPrompt({ name: options.name, arguments: options.args });
  }
  return client.readResource({ uri: options.uri });
}

export async function mcpDisconnect({ requestId }: { requestId: string }) {
  const pending = connecting.get(requestId);
  connecting.delete(requestId);
  await pending?.close().catch(() => undefined);
  const client = connections.get(requestId);
  connections.delete(requestId);
  if (client) {
    await client.close().catch(() => undefined);
    notifyClosed(requestId);
  }
}

export const mcpIsConnected = ({ requestId }: { requestId: string }) => connections.has(requestId);

export const mcpDisconnectAll = () => Promise.all([...connections.keys()].map(requestId => mcpDisconnect({ requestId })));

export interface McpClientBridgeAPI {
  connect: typeof mcpConnect;
  call: typeof mcpCall;
  disconnect: typeof mcpDisconnect;
  isConnected: (options: { requestId: string }) => Promise<boolean>;
}

export const registerMcpClientHandlers = () => {
  ipcMain.handle('mcpClient.connect', (_, options: McpConnectOptions) => mcpConnect(options));
  ipcMain.handle('mcpClient.call', (_, options: McpCallOptions) => mcpCall(options));
  ipcMain.handle('mcpClient.disconnect', (_, options: { requestId: string }) => mcpDisconnect(options));
  ipcMain.handle('mcpClient.isConnected', (_, options: { requestId: string }) => mcpIsConnected(options));
};
