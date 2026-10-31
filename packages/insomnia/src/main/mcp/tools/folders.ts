import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as models from '../../../models';
import { findWorkspaceForRequest } from './util';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// whether id is folderId or one of the folders inside it
async function isWithin(id: string, folderId: string) {
  const seen = new Set<string>();
  for (let cur: string | null = id; cur && !seen.has(cur); cur = (await models.requestGroup.getById(cur))?.parentId ?? null) {
    if (cur === folderId) {
      return true;
    }
    seen.add(cur);
  }
  return false;
}

// Folders (request groups), past create_request_group: changing, moving,
// copying and deleting them, as the sidebar does
export function registerFolderTools(server: McpServer) {
  server.tool(
    'update_request_group',
    "Change a folder's name or description, or move it with what's in it (parentId: a workspace, this one or another, or a folder in one), as the folder's Move to Workspace does.",
    { requestGroupId: z.string(), name: z.string().optional(), description: z.string().optional(), parentId: z.string().optional() },
    async ({ requestGroupId, name, description, parentId }) => {
      const folder = await models.requestGroup.getById(requestGroupId);
      if (!folder) {
        return text({ error: 'folder not found' }, true);
      }
      if (parentId && parentId !== folder.parentId) {
        const target = await models.workspace.getById(parentId) || await models.requestGroup.getById(parentId);
        if (!target || !await findWorkspaceForRequest(parentId)) {
          return text({ error: 'parentId is not a workspace or a folder' }, true);
        }
        if (await isWithin(parentId, requestGroupId)) {
          return text({ error: 'a folder cannot move into itself or a folder inside it' }, true);
        }
      }
      await models.requestGroup.update(folder, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(parentId ? { parentId } : {}),
      });
      return text({ ok: true, id: requestGroupId });
    },
  );

  server.tool(
    'duplicate_request_group',
    'Copy a folder with everything in it (its folders and requests, not their responses), next to it. The copy is named "<name> (Copy)" unless name is given.',
    { requestGroupId: z.string(), name: z.string().optional() },
    async ({ requestGroupId, name }) => {
      const folder = await models.requestGroup.getById(requestGroupId);
      if (!folder) {
        return text({ error: 'folder not found' }, true);
      }
      const copy = await models.requestGroup.duplicate(folder, name ? { name } : {});
      models.stats.incrementCreatedRequestsForDescendents(copy);
      return text({ ok: true, id: copy._id, name: copy.name, parentId: copy.parentId });
    },
  );

  server.tool(
    'delete_request_group',
    'Delete a folder AND everything in it: its folders, requests and their responses. This cannot be undone.',
    { requestGroupId: z.string() },
    async ({ requestGroupId }) => {
      const folder = await models.requestGroup.getById(requestGroupId);
      if (!folder) {
        return text({ error: 'folder not found' }, true);
      }
      await models.stats.incrementDeletedRequestsForDescendents(folder);
      await models.requestGroup.remove(folder);
      return text({ ok: true, id: requestGroupId });
    },
  );
}
