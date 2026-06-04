import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as models from '../../../models';

export function registerWorkspaceTools(server: McpServer) {
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
    'list_request_groups',
    'List request folders (groups) inside a workspace.',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const all = await models.requestGroup.findByParentId(workspaceId);
      // findByParentId is direct-children only; chain-walk for nested folders.
      const everything = await models.requestGroup.all();
      const inWorkspace = everything.filter(g => isInWorkspace(g.parentId, workspaceId, everything));
      const groups = [...new Set([...all, ...inWorkspace])];
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

function isInWorkspace(parentId: string | null, workspaceId: string, groups: { _id: string; parentId: string | null }[]): boolean {
  let cur = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === workspaceId) return true;
    seen.add(cur);
    const next = groups.find(g => g._id === cur);
    cur = next ? next.parentId : null;
  }
  return false;
}
