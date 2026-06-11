import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { database } from '../../../common/database';
import * as models from '../../../models';
import { addDirectoryFromPath, addFileFromPath } from '../../../network/grpc/proto-loader';
import { loadMethods } from '../../ipc/grpc';

export function registerProtoTools(server: McpServer) {
  server.tool(
    'list_proto_files',
    'List proto files known to a workspace (uploaded individually or as part of a directory).',
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const filtered = await database.findDescendants(workspaceId, [models.protoFile.type]);
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

  server.tool(
    'import_proto_directory',
    'Recursively import all .proto files under directoryPath into a workspace. Mirrors the "Add Directory" button in the UI. Per-file parse errors are returned; partial imports still succeed for the files that parsed.',
    {
      workspaceId: z.string(),
      directoryPath: z.string().describe('Absolute path to the proto root directory on disk.'),
    },
    async ({ workspaceId, directoryPath }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'workspace not found' }) }], isError: true };
      }
      const result = await addDirectoryFromPath(directoryPath, workspace);
      const loaded = result.success ? result.loaded : [];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            loadedCount: loaded.length,
            loaded: loaded.map(f => ({ id: f._id, name: f.name, parentId: f.parentId })),
            errors: result.errors,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'import_proto_file',
    'Import a single .proto file into a workspace.',
    {
      workspaceId: z.string(),
      filePath: z.string(),
    },
    async ({ workspaceId, filePath }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'workspace not found' }) }], isError: true };
      }
      const result = await addFileFromPath(filePath, workspace);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            loaded: result.success ? result.loaded.map(f => ({ id: f._id, name: f.name })) : [],
            errors: result.errors,
          }, null, 2),
        }],
      };
    },
  );
}
