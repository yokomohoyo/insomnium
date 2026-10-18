import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { version } from '../../package.json';
import { database } from '../common/database';
import { registerTools } from '../main/mcp/tools';
import * as models from '../models';
import { setRequestPolicy } from '../network/request-policy';
import { disableTemplateTags } from '../templating';
import type { ServerConfig } from './config';
import { startHttpServer } from './http';
import { loadCollection, applyEnvironment } from './load';
import { makeHostPolicy } from './policy';

// Reading and sending only: nothing that changes the collections, their
// environments or auth, or imports files
export const SERVER_TOOLS = new Set([
  'list_projects',
  'list_workspaces',
  'list_request_groups',
  'list_requests',
  'get_request',
  'get_request_type',
  'list_responses',
  'get_response',
  'get_last_response',
  'list_environments',
  'get_active_environment',
  'set_active_environment',
  'list_auth_strategies',
  'list_proto_files',
  'get_proto_methods',
  'send_http_request',
  'send_grpc_request',
]);

export async function startServer(config: ServerConfig) {
  await database.init(models.types(), { inMemoryOnly: true }, true, () => {});
  await models.project.all();
  await models.settings.patch({ validateSSL: config.validateSSL });
  // file would let a template read the container's files into a request
  disableTemplateTags(['file']);
  setRequestPolicy(makeHostPolicy(config.allowedHosts));

  const workspaces = [];
  for (const collection of config.collections) {
    workspaces.push(...await loadCollection(collection));
  }
  await applyEnvironment(workspaces, config.environment, config.variables);

  const http = await startHttpServer({
    host: config.host,
    port: config.port,
    token: config.token,
    buildServer: () => {
      const server = new McpServer({ name: 'insomnium-server', version });
      registerTools(server, name => SERVER_TOOLS.has(name));
      return server;
    },
  });
  return { http, workspaces };
}
