import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAuthTools } from './auth';
import { registerCollectionTools } from './collections';
import { registerCookieTools } from './cookies';
import { registerDesignTools } from './design';
import { registerDiscoveryTools } from './discover';
import { registerEnvironmentTools } from './environments';
import { registerExampleTools } from './examples';
import { registerFolderTools } from './folders';
import { registerGrpcTools } from './grpc';
import { registerEnvironmentMutationTools } from './mutate-environments';
import { registerRequestMutationTools } from './mutate-requests';
import { registerProtoTools } from './proto';
import { registerRequestTools } from './requests';
import { registerSendTool } from './send';
import { registerWorkspaceAdminTools } from './workspace-admin';
import { registerWorkspaceTools } from './workspaces';

// The core of the tools, for a client with little room for their
// descriptions (Postman's MCP server has a minimal set too): find, read,
// send, run, and the few edits most work needs. A client asks for it with
// /sse?tools=minimal, or `insomnium-mcp --minimal`.
export const MINIMAL_TOOLS = new Set([
  'search',
  'list_workspaces',
  'list_requests',
  'get_request',
  'create_request',
  'update_request',
  'list_environments',
  'get_active_environment',
  'set_active_environment',
  'send_http_request',
  'get_last_response',
  'run_requests',
  'generate_code',
]);

// The server, offering only the tools `include` lets through; everything else
// (resources, instructions) passes as is
export const filterTools = (server: McpServer, include: (name: string) => boolean): McpServer => new Proxy(server, {
  get: (target, property, receiver) => property === 'tool'
    ? (name: string, ...rest: unknown[]) => include(name) ? (target.tool as (...args: unknown[]) => unknown).call(target, name, ...rest) : undefined
    : Reflect.get(target, property, receiver),
});

// `include` limits the tools by name (the headless server's read and send
// set); the tools only ever call server.tool
export function registerTools(server: McpServer, include?: (name: string) => boolean) {
  const target = include
    ? { tool: (name: string, ...rest: unknown[]) => include(name) ? (server.tool as (...args: unknown[]) => unknown)(name, ...rest) : undefined } as unknown as McpServer
    : server;
  registerWorkspaceTools(target);
  registerEnvironmentTools(target);
  registerRequestTools(target);
  registerSendTool(target);
  registerRequestMutationTools(target);
  registerEnvironmentMutationTools(target);
  registerAuthTools(target);
  registerProtoTools(target);
  registerGrpcTools(target);
  registerCollectionTools(target);
  registerExampleTools(target);
  registerDesignTools(target);
  registerWorkspaceAdminTools(target);
  registerFolderTools(target);
  registerCookieTools(target);
  registerDiscoveryTools(target);
}
