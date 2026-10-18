import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getRenderedRequestAndContext } from '../../../common/render';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import * as networkUtils from '../../../network/network';
import { assertSafeRequestUrl, findWorkspaceForRequest } from './util';

export function registerSendTool(server: McpServer) {
  server.tool(
    'send_http_request',
    'Send an HTTP request by id and store the response. Returns the new response id, status, elapsed time, and the results of its assertions when it has any. Call get_last_response (or get_response with the returned id) to retrieve the body.',
    {
      requestId: z.string(),
      environmentId: z.string().nullable().optional().describe('Override the active environment for this call. Null = no environment overrides; omit = use workspace active environment.'),
    },
    async ({ requestId, environmentId }) => {
      const req = await models.request.getById(requestId);
      if (!req || !isRequest(req)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'HTTP request not found' }) }], isError: true };
      }
      const workspace = await findWorkspaceForRequest(req.parentId);
      let envId: string | null | undefined = environmentId;
      if (envId === undefined && workspace) {
        const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
        envId = meta.activeEnvironmentId;
      }
      const settings = await models.settings.getOrCreate();
      const { request: rendered } = await getRenderedRequestAndContext({
        request: req,
        environmentId: envId || '',
      });
      // Validate the FINAL url (after params/segments/auth query params fold in)
      // so an LLM can't bypass the SSRF guard via a malicious segment/param.
      // Headers are validated in the network send path.
      try {
        const { finalUrl } = networkUtils.transformUrl(rendered.url, rendered.parameters, rendered.segmentParams, rendered.authentication, rendered.settingEncodeUrl);
        assertSafeRequestUrl(finalUrl);
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (err as Error).message }) }], isError: true };
      }
      // No redirects: the SSRF guard only checks the initial url, so libcurl
      // following a 30x to a metadata host would bypass it.
      rendered.settingFollowRedirects = 'off';
      // Certificates are parented to the workspace, not the request's folder.
      const certParentId = workspace ? workspace._id : req.parentId;
      const clientCertificates = await models.clientCertificate.findByParentId(certParentId);
      const caCert = await models.caCertificate.findByParentId(certParentId);
      const response = await networkUtils.sendCurlAndWriteTimeline(
        rendered,
        clientCertificates,
        caCert,
        settings,
      );
      // libcurl writes the body uncompressed (as responseTransform records for
      // Send); left unset, migration would mark it zip and reading would fail
      const checked = networkUtils.withAssertionResults(rendered, { ...response, bodyCompression: null });
      const stored = await models.response.create(checked, settings.maxHistoryResponses);
      const results = checked.assertionResults;
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
            ...(results ? {
              assertions: {
                passed: results.filter(result => result.passed).length,
                failed: results.filter(result => !result.passed).length,
                results: results.map(({ passed, message }) => ({ passed, message })),
              },
            } : {}),
          }, null, 2),
        }],
      };
    },
  );
}
