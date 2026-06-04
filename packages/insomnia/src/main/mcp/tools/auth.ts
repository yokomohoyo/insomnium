import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as requestOperations from '../../../models/helpers/request-operations';
import {
  addAuthStrategy,
  getAuthStrategies,
  patchAuthStrategy,
  removeAuthStrategy,
} from '../../../models/request';

export function registerAuthTools(server: McpServer) {
  server.tool(
    'list_auth_strategies',
    'List the auth strategies on a request. Returns each strategy with its index.',
    { requestId: z.string() },
    async ({ requestId }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      const strategies = getAuthStrategies((req as any).authentication);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(strategies.map((s, i) => ({ index: i, ...s })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'add_auth_strategy',
    'Append a new auth strategy. `strategy` is the full object — e.g. {"type":"bearer","token":"abc"}, {"type":"basic","username":"u","password":"p"}, or {"type":"gcp-id-token","credentialSource":"adc","audience":"https://x"}. Optional `headerName` overrides the destination header.',
    {
      requestId: z.string(),
      strategy: z.record(z.string(), z.any()),
    },
    async ({ requestId, strategy }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      const next = addAuthStrategy((req as any).authentication, strategy as any);
      await requestOperations.update(req as any, { authentication: next });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, strategies: next.length }) }] };
    },
  );

  server.tool(
    'update_auth_strategy',
    'Merge a patch into an existing auth strategy by index.',
    {
      requestId: z.string(),
      index: z.number().int().min(0),
      patch: z.record(z.string(), z.any()),
    },
    async ({ requestId, index, patch }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      const next = patchAuthStrategy((req as any).authentication, index, patch);
      await requestOperations.update(req as any, { authentication: next });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, index }) }] };
    },
  );

  server.tool(
    'remove_auth_strategy',
    'Remove an auth strategy by index.',
    {
      requestId: z.string(),
      index: z.number().int().min(0),
    },
    async ({ requestId, index }) => {
      const req = await requestOperations.getById(requestId);
      if (!req) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not found' }) }], isError: true };
      }
      const next = removeAuthStrategy((req as any).authentication, index);
      await requestOperations.update(req as any, { authentication: next });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, strategies: next.length }) }] };
    },
  );
}
