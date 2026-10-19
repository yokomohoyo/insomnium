import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { version } from '../../package.json';
import { database } from '../common/database';
import { registerTools } from '../main/mcp/tools';
import * as models from '../models';
import { setRequestPolicy } from '../network/request-policy';
import { disableTemplateTags } from '../templating';
import type { Workspace } from '../models/workspace';
import { isWorkspace } from '../models/workspace';
import type { ServerConfig } from './config';
import { startHttpServer } from './http';
import { loadCollection, applyEnvironment } from './load';
import { makeHostPolicy } from './policy';
import { openRepo, type Repo, syncRepoDocs } from './repo';
import type { Sources } from './sources';

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
  // sends and reads: the runner, and an export of what's loaded
  'run_requests',
  'export_workspace',
]);

type LoadConfig = Sources & Pick<ServerConfig, 'environment' | 'variables' | 'validateSSL' | 'allowedHosts' | 'allowedEnvironmentVariables'> & { allowedSecrets?: string };

// The in-memory database with the collections and repositories loaded, for
// serving or a run. update() brings the repositories' workspaces up to date,
// as serve does every --pull-interval, and says which changed.
export async function loadSources(config: LoadConfig) {
  await database.init(models.types(), { inMemoryOnly: true }, true, () => {});
  await models.project.all();
  // the proxy a container or CI runner is given: HTTPS_PROXY, HTTP_PROXY, NO_PROXY
  await models.settings.patch({ validateSSL: config.validateSSL, allowedEnvironmentVariables: config.allowedEnvironmentVariables, allowedSecrets: config.allowedSecrets || '', useSystemProxy: true });
  // file would let a template read the container's files into a request
  disableTemplateTags(['file']);
  setRequestPolicy(makeHostPolicy(config.allowedHosts));

  const workspaces: Workspace[] = [];
  for (const collection of config.collections) {
    workspaces.push(...await loadCollection(collection));
  }
  const repos: { repo: Repo; version: string }[] = [];
  for (const location of config.repos) {
    const repo = await openRepo(location, { branch: config.branch, token: config.gitToken, username: config.gitUsername });
    const { docs, version } = await repo.read();
    const id = docs.find(isWorkspace)?._id;
    if (workspaces.some(workspace => workspace._id === id)) {
      throw new Error(`${location} holds a workspace that's already loaded from another collection or repository`);
    }
    workspaces.push(await syncRepoDocs(docs, location));
    repos.push({ repo, version });
  }
  await applyEnvironment(workspaces, config.environment, config.variables);

  const update = async () => {
    const changed: { location: string; version: string }[] = [];
    for (const entry of repos) {
      await entry.repo.update();
      const { docs, version } = await entry.repo.read();
      if (version !== entry.version) {
        await syncRepoDocs(docs, entry.repo.location);
        entry.version = version;
        changed.push({ location: entry.repo.location, version });
      }
    }
    // the variables and the environment chosen, over what changed
    if (changed.length) {
      await applyEnvironment(workspaces, config.environment, config.variables);
    }
    return changed;
  };
  return { workspaces, update, repoCount: repos.length };
}

// The in-memory database with the collections loaded, for a run
export async function loadWorkspaces(config: LoadConfig) {
  return (await loadSources(config)).workspaces;
}

export async function startServer(config: ServerConfig) {
  const { workspaces, update, repoCount } = await loadSources(config);
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

  // the repositories brought up to date as they change, one update at a time
  let updating = false;
  const timer = repoCount && config.pullInterval > 0 ? setInterval(() => {
    if (updating) {
      return;
    }
    updating = true;
    update()
      .then(changed => changed.forEach(({ location, version }) => console.log(`[server] updated ${location} to ${version.slice(0, 12)}`)))
      .catch(err => console.warn(`[server] could not update the repositories: ${(err as Error).message}`))
      .finally(() => {
        updating = false;
      });
  }, config.pullInterval * 1000) : undefined;
  http.on('close', () => clearInterval(timer));
  return { http, workspaces, update };
}
