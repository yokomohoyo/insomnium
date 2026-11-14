import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { database } from '../../../common/database';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import { compact, fail, json, notFound } from './util';

export function registerWorkspaceTools(server: McpServer) {
  server.tool(
    'list_projects',
    'List all top-level projects (containers for workspaces).',
    {},
    async () => {
      const projects = await models.project.all();
      return json(projects.map(p => ({ id: p._id, name: p.name })));
    },
  );

  server.tool(
    'create_project',
    'Create a new local project. Workspaces (collections + design docs) are created under projects.',
    { name: z.string() },
    async ({ name }) => {
      const p = await models.project.create({ name });
      return compact({ id: p._id, name: p.name });
    },
  );

  server.tool(
    'list_workspaces',
    'List all workspaces (collections + design documents) in this Insomnium instance.',
    {},
    async () => {
      const workspaces = await models.workspace.all();
      return json(workspaces.map(w => ({
        id: w._id,
        name: w.name,
        scope: w.scope,
        parentId: w.parentId,
      })));
    },
  );

  server.tool(
    'create_workspace',
    'Create a new workspace (collection or design doc). parentId is the projectId you want it under (use proj_default-project for the default project, or one of the proj_* ids from list_projects).',
    {
      name: z.string().default('New Collection'),
      scope: z.enum(['collection', 'design']).default('collection'),
      parentId: z.string().default(DEFAULT_PROJECT_ID),
    },
    async ({ name, scope, parentId }) => {
      const project = await models.project.getById(parentId);
      if (!project) {
        return fail(`project ${parentId} not found - use list_projects to see valid ids`);
      }
      const ws = await models.workspace.create({ name, scope, parentId });
      // as the app's own create does: a design doc's Spec needs its spec
      if (scope === 'design') {
        await models.apiSpec.getOrCreateForParentId(ws._id);
      }
      await models.environment.getOrCreateForParentId(ws._id);
      await models.cookieJar.getOrCreateForParentId(ws._id);
      await models.workspaceMeta.getOrCreateByParentId(ws._id);
      return compact({ id: ws._id, name: ws.name, scope: ws.scope, parentId: ws.parentId });
    },
  );

  server.tool(
    'delete_workspace',
    'Delete a workspace and everything in it (requests, folders, environments, spec, tests, flows, responses). It cannot be undone, so `name` must repeat the workspace\'s name exactly, as a check that this is the one meant.',
    { workspaceId: z.string(), name: z.string() },
    async ({ workspaceId, name }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace) {
        return notFound('workspace');
      }
      if (workspace.name !== name) {
        return fail(`name does not match: the workspace is named ${JSON.stringify(workspace.name)}`);
      }
      // as the app's own delete does
      await models.stats.incrementDeletedRequestsForDescendents(workspace);
      await models.workspace.remove(workspace);
      return compact({ ok: true, workspaceId, name });
    },
  );

  server.tool(
    'list_request_groups',
    'List request folders (groups) inside a workspace.',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const groups = await database.findDescendants(workspaceId, [models.requestGroup.type]);
      return json(groups.map(g => ({ id: g._id, name: g.name, parentId: g.parentId })));
    },
  );
}
