import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { database } from '../../../common/database';
import { exportHarWithRequest } from '../../../common/har';
import type { BaseModel } from '../../../models';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import { findWorkspaceForRequest, requestTypeLabel } from './util';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

const REQUEST_TYPES = [models.request.type, models.grpcRequest.type, models.webSocketRequest.type, models.mcpRequest.type];

type Named = BaseModel & { name?: string; url?: string; method?: string };

// Finding things without paging through every list, and code that sends a request
export function registerDiscoveryTools(server: McpServer) {
  server.tool(
    'search',
    "Find requests (any type), folders, workspaces and environments by name, or requests by URL or method, across every workspace or one (workspaceId). Case-insensitive. Each result has its id, kind, and where it is: its workspace and folders. Use it before list_requests when you know roughly what you're looking for.",
    {
      query: z.string().trim().min(1),
      workspaceId: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ query, workspaceId, limit }) => {
      const needle = query.toLowerCase();
      const workspaces = workspaceId
        ? [await models.workspace.getById(workspaceId)].filter(Boolean)
        : await models.workspace.all();
      if (workspaceId && !workspaces.length) {
        return text({ error: 'workspace not found' }, true);
      }
      // every workspace's folders and environments, to say where each result is
      const folders: Named[] = [];
      const environments: Named[] = [];
      const requests: Named[] = [];
      for (const workspace of workspaces) {
        folders.push(...await database.findDescendants<Named>(workspace!._id, [models.requestGroup.type]));
        environments.push(...await database.findDescendants<Named>(workspace!._id, [models.environment.type]));
        requests.push(...await database.findDescendants<Named>(workspace!._id, REQUEST_TYPES));
      }
      const byId = new Map<string, Named>([...workspaces, ...folders, ...environments].map(doc => [doc!._id, doc!]));
      const where = (doc: Named) => {
        const path: string[] = [];
        let parent = byId.get(doc.parentId);
        while (parent) {
          // a sub environment's parent is the base one, which names nothing useful
          if (parent.type !== models.environment.type) {
            path.unshift(parent.name || '');
          }
          parent = byId.get(parent.parentId);
        }
        return path.join(' / ');
      };
      const matches = (doc: Named) =>
        (doc.name || '').toLowerCase().includes(needle)
        || (REQUEST_TYPES.includes(doc.type) && ((doc.url || '').toLowerCase().includes(needle) || (doc.method || '').toLowerCase() === needle));
      const kindOf = (doc: Named) => doc.type === models.workspace.type ? 'workspace'
        : doc.type === models.requestGroup.type ? 'folder'
        : doc.type === models.environment.type ? 'environment'
        : 'request';
      const found = [...requests, ...folders, ...workspaces as Named[], ...environments].filter(matches);
      return text({
        total: found.length,
        results: found.slice(0, limit).map(doc => ({
          id: doc._id,
          kind: kindOf(doc),
          name: doc.name,
          ...(kindOf(doc) === 'request' ? { type: requestTypeLabel(doc), method: doc.method, url: doc.url } : {}),
          where: where(doc),
        })),
      });
    },
  );

  server.tool(
    'generate_code',
    "Generate code that sends an HTTP request, as the app's Generate Code does (httpsnippet), with its templates rendered in the active environment (or environmentId). target is a language: shell, javascript, node, python, go, java, kotlin, csharp, php, ruby, swift, c, objc, ocaml, r, http, powershell, clojure. client picks a library within it, such as curl or wget for shell, fetch or axios for javascript, requests for python; its default when left out. A wrong target or client lists the ones there are.",
    {
      requestId: z.string(),
      target: z.string().default('shell'),
      client: z.string().optional(),
      environmentId: z.string().optional(),
    },
    async ({ requestId, target, client, environmentId }) => {
      const request = await models.request.getById(requestId);
      if (!request || !isRequest(request)) {
        return text({ error: 'HTTP request not found' }, true);
      }
      const { HTTPSnippet, availableTargets } = await import('httpsnippet');
      const targets = availableTargets();
      const choices = targets.map(({ key, clients }) => ({ target: key, clients: clients.map(({ key: clientKey }) => clientKey) }));
      const chosenTarget = targets.find(({ key }) => key === target);
      if (!chosenTarget) {
        return text({ error: `no target '${target}'`, targets: choices }, true);
      }
      const chosenClient = client ? chosenTarget.clients.find(({ key }) => key === client) : chosenTarget.clients.find(({ key }) => key === chosenTarget.default) || chosenTarget.clients[0];
      if (!chosenClient) {
        return text({ error: `no client '${client}' for ${target}`, clients: choices.find(choice => choice.target === target)?.clients }, true);
      }
      let envId = environmentId;
      if (envId === undefined) {
        const workspace = await findWorkspaceForRequest(request.parentId);
        envId = workspace ? (await models.workspaceMeta.getOrCreateByParentId(workspace._id)).activeEnvironmentId || undefined : undefined;
      }
      let har;
      try {
        har = await exportHarWithRequest(request, envId);
      } catch (err) {
        return text({ error: (err as Error).message }, true);
      }
      if (!har) {
        return text({ error: 'the request could not be rendered' }, true);
      }
      const code = new HTTPSnippet(har as any).convert(chosenTarget.key, chosenClient.key);
      if (code === false) {
        return text({ error: `httpsnippet could not write ${chosenTarget.key} ${chosenClient.key} for this request` }, true);
      }
      return text({ target: chosenTarget.key, client: chosenClient.key, code: Array.isArray(code) ? code.join('\n') : code });
    },
  );
}
