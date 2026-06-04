import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loadMethods } from '../../ipc/grpc';
import * as models from '../../../models';

export function registerProtoTools(server: McpServer) {
  server.tool(
    'list_proto_files',
    'List proto files known to a workspace (uploaded individually or as part of a directory).',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const protoFiles = await models.protoFile.all();
      const protoDirs = await models.protoDirectory.all();
      const inWorkspace = (parentId: string | null | undefined): boolean => {
        let cur: string | null | undefined = parentId;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          if (cur === workspaceId) return true;
          seen.add(cur);
          const next = protoDirs.find(d => d._id === cur);
          cur = next ? next.parentId : null;
        }
        return false;
      };
      const filtered = protoFiles.filter(p => inWorkspace(p.parentId));
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            filtered.map(p => ({ id: p._id, name: p.name, parentId: p.parentId })),
            null,
            2,
          ),
        }],
      };
    },
  );

  server.tool(
    'get_proto_methods',
    'Load a proto file and return its services + methods (with auto-generated request body templates when available).',
    { protoFileId: z.string() },
    async ({ protoFileId }) => {
      try {
        const methods = await loadMethods(protoFileId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              methods.map(m => ({ fullPath: m.fullPath, type: m.type, example: m.example })),
              null,
              2,
            ),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (err as Error).message }) }], isError: true };
      }
    },
  );
}
