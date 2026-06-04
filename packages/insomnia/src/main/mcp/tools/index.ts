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

export function registerTools(server: McpServer) {
  registerWorkspaceTools(server);
  registerEnvironmentTools(server);
  registerRequestTools(server);
  registerSendTool(server);
  registerRequestMutationTools(server);
  registerEnvironmentMutationTools(server);
  registerAuthTools(server);
  registerProtoTools(server);
  registerGrpcTools(server);
}
