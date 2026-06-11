import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { database } from '../../../common/database';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';

export function registerWorkspaceTools(server: McpServer) {
  server.tool(
    'list_projects',
    'List all top-level projects (containers for workspaces).',
    {},
    async () => {
      const projects = await models.project.all();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(projects.map(p => ({ id: p._id, name: p.name, remoteId: p.remoteId })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'create_project',
    'Create a new local project. Workspaces (collections + design docs) are created under projects.',
    { name: z.string() },
    async ({ name }) => {
      const p = await models.project.create({ name });
      return {
        content: [{ type: 'text', text: JSON.stringify({ id: p._id, name: p.name }) }],
      };
    },
  );

  server.tool(
    'list_workspaces',
    'List all workspaces (collections + design documents) in this Insomnium instance.',
    {},
    async () => {
      const workspaces = await models.workspace.all();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            workspaces.map(w => ({
              id: w._id,
              name: w.name,
              scope: w.scope,
              parentId: w.parentId,
            })),
            null,
            2,
          ),
        }],
      };
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
        return { content: [{ type: 'text', text: JSON.stringify({ error: `project ${parentId} not found - use list_projects to see valid ids` }) }], isError: true };
      }
      const ws = await models.workspace.create({ name, scope, parentId });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ id: ws._id, name: ws.name, scope: ws.scope, parentId: ws.parentId }),
        }],
      };
    },
  );

  server.tool(
    'list_request_groups',
    'List request folders (groups) inside a workspace.',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const groups = await database.findDescendants(workspaceId, [models.requestGroup.type]);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            groups.map(g => ({ id: g._id, name: g.name, parentId: g.parentId })),
            null,
            2,
          ),
        }],
      };
    },
  );
}
