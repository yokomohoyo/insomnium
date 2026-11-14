import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { setEnvironmentData } from '../../../common/environment-secrets';
import * as models from '../../../models';
import { compact, fail, notFound } from './util';

export function registerEnvironmentMutationTools(server: McpServer) {
  server.tool(
    'create_environment',
    'Create a sub-environment under the workspace base environment.',
    {
      workspaceId: z.string(),
      name: z.string().default('New Environment'),
      data: z.record(z.string(), z.any()).optional(),
    },
    async ({ workspaceId, name, data }) => {
      const base = await models.environment.getOrCreateForParentId(workspaceId);
      const env = await models.environment.create({ parentId: base._id, name, data: data || {} });
      return compact({ id: env._id, name: env.name });
    },
  );

  server.tool(
    'update_environment',
    'Patch an environment. Variables in `data` merge shallowly with existing ones; pass null for a key to clear it.',
    {
      environmentId: z.string(),
      name: z.string().optional(),
      data: z.record(z.string(), z.any()).optional(),
    },
    async ({ environmentId, name, data }) => {
      const env = await models.environment.getById(environmentId);
      if (!env) {
        return notFound();
      }
      const patch: any = {};
      if (typeof name === 'string') patch.name = name;
      if (data) {
        const merged = { ...(env.data || {}) };
        for (const [k, v] of Object.entries(data)) {
          if (v === null) delete merged[k]; else merged[k] = v;
        }
        // a secret variable's value goes to its secrets, not the data
        await setEnvironmentData(env, merged, patch);
      } else {
        await models.environment.update(env, patch);
      }
      return compact({ ok: true, environmentId });
    },
  );

  server.tool(
    'delete_environment',
    'Delete a sub-environment. Refuses to delete the workspace base environment.',
    { environmentId: z.string() },
    async ({ environmentId }) => {
      const env = await models.environment.getById(environmentId);
      if (!env) {
        return notFound();
      }
      const parent = await models.environment.getById(env.parentId);
      // Base envs have a workspace parent (not an env), so getById returns null.
      if (!parent) {
        return fail('cannot delete base environment');
      }
      await models.environment.remove(env);
      return compact({ ok: true, environmentId });
    },
  );
}
