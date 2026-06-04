import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as models from '../../../models';

export function registerEnvironmentTools(server: McpServer) {
  server.tool(
    'list_environments',
    'List environments under a workspace (base + sub-environments).',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const baseEnv = await models.environment.getOrCreateForParentId(workspaceId);
      const subs = await models.environment.findByParentId(baseEnv._id);
      const envs = [baseEnv, ...subs];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            envs.map(e => ({
              id: e._id,
              name: e.name,
              parentId: e.parentId,
              isBase: e.parentId === workspaceId,
            })),
            null,
            2,
          ),
        }],
      };
    },
  );

  server.tool(
    'get_active_environment',
    'Get the currently active environment for a workspace.',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const meta = await models.workspaceMeta.getOrCreateByParentId(workspaceId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ activeEnvironmentId: meta.activeEnvironmentId }),
        }],
      };
    },
  );

  server.tool(
    'set_active_environment',
    'Set the active environment for a workspace by environment id.',
    { workspaceId: z.string(), environmentId: z.string().nullable() },
    async ({ workspaceId, environmentId }) => {
      const meta = await models.workspaceMeta.getOrCreateByParentId(workspaceId);
      await models.workspaceMeta.update(meta, { activeEnvironmentId: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, activeEnvironmentId: environmentId }) }] };
    },
  );
}
