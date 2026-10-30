import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { database } from '../../../common/database';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import type { Workspace } from '../../../models/workspace';
import { isDesign } from '../../../models/workspace';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

const summary = ({ _id, name, scope, parentId }: Workspace) => ({ id: _id, name, scope, parentId });

// Renaming, moving, converting and copying workspaces, and renaming and
// deleting projects, as the dashboard's menus do
export function registerWorkspaceAdminTools(server: McpServer) {
  server.tool(
    'update_workspace',
    'Rename a workspace, change its description, move it to another project (projectId, from list_projects), or convert it (scope): a collection becomes a design document with a Spec, or a design document a collection (its spec is kept for if it becomes one again).',
    {
      workspaceId: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      projectId: z.string().optional(),
      scope: z.enum(['collection', 'design']).optional(),
    },
    async ({ workspaceId, name, description, projectId, scope }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace) {
        return text({ error: 'workspace not found' }, true);
      }
      if (projectId && !await models.project.getById(projectId)) {
        return text({ error: `project ${projectId} not found - use list_projects to see valid ids` }, true);
      }
      // a design document's spec is named after it: renamed with it, or
      // made with its name when a collection becomes one
      if ((scope || workspace.scope) === 'design' && (name || !await models.apiSpec.getByParentId(workspaceId))) {
        await models.apiSpec.updateOrCreateForParentId(workspaceId, { fileName: name || workspace.name });
      }
      const updated = await models.workspace.update(workspace, {
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(projectId ? { parentId: projectId } : {}),
        ...(scope ? { scope } : {}),
      });
      return text({ ok: true, ...summary(updated) });
    },
  );

  server.tool(
    'duplicate_workspace',
    'Copy a workspace with everything in it (its requests, folders, environments, spec, tests and flows, not its responses), into its own project or another (projectId). The copy is named "<name> (Copy)" unless name is given.',
    { workspaceId: z.string(), name: z.string().min(1).optional(), projectId: z.string().optional() },
    async ({ workspaceId, name, projectId }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace) {
        return text({ error: 'workspace not found' }, true);
      }
      const parentId = projectId || workspace.parentId;
      if (!await models.project.getById(parentId)) {
        return text({ error: `project ${parentId} not found - use list_projects to see valid ids` }, true);
      }
      const copyName = name || `${workspace.name} (Copy)`;
      const copy = await database.duplicate(workspace, { name: copyName, parentId });
      if (isDesign(copy)) {
        await models.apiSpec.updateOrCreateForParentId(copy._id, { fileName: copyName });
      }
      models.stats.incrementCreatedRequestsForDescendents(copy);
      await models.environment.getOrCreateForParentId(copy._id);
      await models.cookieJar.getOrCreateForParentId(copy._id);
      await models.workspaceMeta.getOrCreateByParentId(copy._id);
      return text({ ok: true, ...summary(copy) });
    },
  );

  server.tool(
    'update_project',
    'Rename a project.',
    { projectId: z.string(), name: z.string().min(1) },
    async ({ projectId, name }) => {
      const project = await models.project.getById(projectId);
      if (!project) {
        return text({ error: 'project not found' }, true);
      }
      await models.project.update(project, { name });
      return text({ ok: true, id: projectId, name });
    },
  );

  server.tool(
    'delete_project',
    'Delete an empty project. This cannot be undone. Refuses a project that still has workspaces (move or delete them first) and the default project.',
    { projectId: z.string() },
    async ({ projectId }) => {
      if (projectId === DEFAULT_PROJECT_ID) {
        return text({ error: 'the default project cannot be deleted' }, true);
      }
      const project = await models.project.getById(projectId);
      if (!project) {
        return text({ error: 'project not found' }, true);
      }
      const workspaces = await models.workspace.findByParentId(projectId);
      if (workspaces.length) {
        return text({ error: `the project still has ${workspaces.length} workspace(s): move or delete them first`, workspaces: workspaces.map(summary) }, true);
      }
      await models.project.remove(project);
      return text({ ok: true, id: projectId });
    },
  );
}
