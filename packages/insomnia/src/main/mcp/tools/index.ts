import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAuthTools } from './auth';
import { registerEnvironmentTools } from './environments';
import { registerGrpcTools } from './grpc';
import { registerEnvironmentMutationTools } from './mutate-environments';
import { registerRequestMutationTools } from './mutate-requests';
import { registerProtoTools } from './proto';
import { registerRequestTools } from './requests';
import { registerSendTool } from './send';
import { registerWorkspaceTools } from './workspaces';

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
}
