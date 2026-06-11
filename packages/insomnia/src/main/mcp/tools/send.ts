import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getRenderedRequestAndContext } from '../../../common/render';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import * as networkUtils from '../../../network/network';

export function registerSendTool(server: McpServer) {
  server.tool(
    'send_http_request',
    'Send an HTTP request by id and store the response. Returns the new response id, status, and elapsed time. Call get_last_response (or get_response with the returned id) to retrieve the body.',
    {
      requestId: z.string(),
      environmentId: z.string().nullable().optional().describe('Override the active environment for this call. Null = no environment overrides; omit = use workspace active environment.'),
    },
    async ({ requestId, environmentId }) => {
      const req = await models.request.getById(requestId);
      if (!req || !isRequest(req)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'HTTP request not found' }) }], isError: true };
      }
      let envId: string | null | undefined = environmentId;
      if (envId === undefined) {
        const workspace = await findWorkspaceForRequest(req.parentId);
        if (workspace) {
          const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
          envId = meta.activeEnvironmentId;
        }
      }
      const settings = await models.settings.getOrCreate();
      const { request: rendered } = await getRenderedRequestAndContext({
        request: req,
        environmentId: envId || '',
      });
      const clientCertificates = await models.clientCertificate.findByParentId(req.parentId);
      const caCert = await models.caCertificate.findByParentId(req.parentId);
      const response = await networkUtils.sendCurlAndWriteTimeline(
        rendered,
        clientCertificates,
        caCert,
        settings,
      );
      const stored = await models.response.create(response, settings.maxHistoryResponses);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            responseId: stored._id,
            statusCode: stored.statusCode,
            statusMessage: stored.statusMessage,
            elapsedTime: stored.elapsedTime,
            url: stored.url,
            error: stored.error,
          }, null, 2),
        }],
      };
    },
  );
}

async function findWorkspaceForRequest(parentId: string) {
  let cur: string | null = parentId;
  const groups = await models.requestGroup.all();
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const ws = await models.workspace.getById(cur);
    if (ws) return ws;
    const g = groups.find(x => x._id === cur);
    cur = g ? g.parentId : null;
  }
  return null;
}
