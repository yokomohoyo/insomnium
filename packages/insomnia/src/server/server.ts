import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { version } from '../../package.json';
import { database } from '../common/database';
import { HEADLESS_INSTRUCTIONS, HEADLESS_SERVER_INSTRUCTIONS, registerInstructions } from '../main/mcp/instructions';
import { registerTools } from '../main/mcp/tools';
import * as models from '../models';
import { setGcpAudienceApproval } from '../network/gcp-id-token/get-token';
import { setRequestPolicy } from '../network/request-policy';
import { disableTemplateTags } from '../templating';
import type { Workspace } from '../models/workspace';
import { isWorkspace } from '../models/workspace';
import { MAX_PULL_INTERVAL, type ServerConfig } from './config';
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
  'search',
  'generate_code',
  'list_responses',
  'get_response',
  'get_last_response',
  'list_response_examples',
  'get_spec',
  'list_test_suites',
  'list_flows',
  'get_flow',
  'list_environments',
  'get_active_environment',
  'set_active_environment',
  'list_auth_strategies',
  'list_proto_files',
  'get_proto_methods',
  'send_http_request',
  'send_grpc_request',
  // sends and reads: the runner and flows, and an export of what's loaded
  'run_requests',
  'run_flow',
  'export_workspace',
]);

type LoadConfig = Sources & Pick<ServerConfig, 'environment' | 'variables' | 'validateSSL' | 'allowedHosts' | 'allowedEnvironmentVariables'> & { allowedSecrets?: string };

// The in-memory database with the collections and repositories loaded, for
// serving or a run. update() brings the repositories' workspaces up to date,
// as serve does every --pull-interval, and says which changed. close() removes
// the clones' folders.
export async function loadSources(config: LoadConfig) {
  await database.init(models.types(), { inMemoryOnly: true }, true, () => {});
  await models.project.all();
  // the proxy a container or CI runner is given: HTTPS_PROXY, HTTP_PROXY, NO_PROXY
  await models.settings.patch({ validateSSL: config.validateSSL, allowedEnvironmentVariables: config.allowedEnvironmentVariables, allowedSecrets: config.allowedSecrets || '', useSystemProxy: true });
  // file would let a template read the container's files into a request
  disableTemplateTags(['file']);
  // no one to ask whether a Google ID token for another service may go to a
  // request's host (network/gcp-id-token/get-token.ts), so it may not
  setGcpAudienceApproval(() => false);
  setRequestPolicy(makeHostPolicy(config.allowedHosts));

  const workspaces: Workspace[] = [];
  for (const collection of config.collections) {
    workspaces.push(...await loadCollection(collection));
  }
  // each with its workspace's place in workspaces
  const repos: { repo: Repo; version: string; index: number }[] = [];
  const close = () => repos.forEach(({ repo }) => repo.close());
  try {
    for (const location of config.repos) {
      const repo = await openRepo(location, { branch: config.branch, token: config.gitToken, username: config.gitUsername });
      const entry = { repo, version: '', index: workspaces.length };
      repos.push(entry);
      const { docs, version } = await repo.read();
      const id = docs.find(isWorkspace)?._id;
      if (workspaces.some(workspace => workspace._id === id)) {
        throw new Error(`${repo.location} holds a workspace that's already loaded from another collection or repository`);
      }
      workspaces.push(await syncRepoDocs(docs, repo.location));
      entry.version = version;
    }
    await applyEnvironment(workspaces, config.environment, config.variables);
  } catch (err) {
    close();
    throw err;
  }

  const update = async () => {
    const changed: { location: string; version: string }[] = [];
    for (const entry of repos) {
      await entry.repo.update();
      const { docs, version } = await entry.repo.read();
      if (version !== entry.version) {
        const workspace = await syncRepoDocs(docs, entry.repo.location);
        workspaces[entry.index] = workspace;
        // the variables and the environment chosen, over what changed, before
        // the next repository, so one that fails can't leave this one without
        // them (the name was checked at load)
        await applyEnvironment([workspace], config.environment, config.variables, false);
        entry.version = version;
        changed.push({ location: entry.repo.location, version });
      }
    }
    return changed;
  };
  return { workspaces, update, close, repoCount: repos.length };
}

// The in-memory database with the collections loaded, for a run. The
// repositories are read in, so their clones aren't kept.
export async function loadWorkspaces(config: LoadConfig) {
  const { workspaces, close } = await loadSources(config);
  close();
  return workspaces;
}

export async function startServer(config: ServerConfig) {
  const { workspaces, update, close, repoCount } = await loadSources(config);
  const http = await startHttpServer({
    host: config.host,
    port: config.port,
    token: config.token,
    tls: config.tls,
    buildServer: () => {
      const server = new McpServer({ name: 'insomnium-server', version }, { instructions: HEADLESS_SERVER_INSTRUCTIONS });
      registerInstructions(server, HEADLESS_INSTRUCTIONS);
      registerTools(server, name => SERVER_TOOLS.has(name));
      return server;
    },
  }).catch(err => {
    close();
    throw err;
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
  }, Math.min(config.pullInterval, MAX_PULL_INTERVAL) * 1000) : undefined;
  http.on('close', () => {
    clearInterval(timer);
    close();
  });
  return { http, workspaces, update };
}
