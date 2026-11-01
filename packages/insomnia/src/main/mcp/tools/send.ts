import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getRenderedRequestAndContext } from '../../../common/render';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import * as networkUtils from '../../../network/network';
import { runPreRequestScript } from '../../../scripting/request-scripts';
import { assertSafeRequestUrl, findWorkspaceForRequest, foreignEnvironment } from './util';

export function registerSendTool(server: McpServer) {
  server.tool(
    'send_http_request',
    'Send an HTTP request by id and store the response, running its pre-request and after-response scripts. Returns the new response id, status, elapsed time, the results of its assertions and script tests when it has any, and what its scripts logged. Call get_last_response (or get_response with the returned id) to retrieve the body.',
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
      const foreign = await foreignEnvironment(workspace?._id, environmentId);
      if (foreign) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: foreign }) }], isError: true };
      }
      let envId: string | null | undefined = environmentId;
      if (envId === undefined && workspace) {
        const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
        envId = meta.activeEnvironmentId;
      }
      const settings = await models.settings.getOrCreate();
      // the pre-request script first, as Send runs it; a failed one stops the send
      let scripted;
      try {
        scripted = await runPreRequestScript(req, { environmentId: envId || null });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (err as Error).message }) }], isError: true };
      }
      const { request: rendered, context } = await getRenderedRequestAndContext({
        request: scripted.request,
        environmentId: envId || '',
        iterationData: scripted.variables,
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
      // as Send keeps it: plugin hooks, assertions, the after-response script
      const checked = await networkUtils.responseTransform(response, envId || null, rendered, context, { preRequestLogs: scripted.logs });
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
            ...(stored.timings ? { timings: stored.timings } : {}),
            url: stored.url,
            error: stored.error,
            ...(results ? {
              assertions: {
                passed: results.filter(result => result.passed).length,
                failed: results.filter(result => !result.passed).length,
                results: results.map(({ passed, message }) => ({ passed, message })),
              },
            } : {}),
            ...(checked.scriptLogs ? { scriptLogs: checked.scriptLogs } : {}),
          }, null, 2),
        }],
      };
    },
  );
}
