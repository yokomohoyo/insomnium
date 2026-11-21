import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { isSafeToRepeat, SECURITY_TEST_MAX_REQUESTS } from '../../../common/security-tests';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import { runRequestSecurityTests } from '../../../network/security-tests';
import { assertSafeRequestUrl, fail, findWorkspaceForRequest, foreignEnvironment, json, notFound, withoutIgnoredSecurityRules } from './util';

// What the user is asked before a run: the tests send the request again, up
// to `requests` times, each changed to see what the API lets through, and a
// client mustn't point that at an API on the user's behalf unasked
export interface SecurityTestRequest {
  request: string;
  method: string;
  url: string;
  workspace: string;
  requests: number;
}
// the signal is the MCP request's: a run the client gives up on is a no
export type ConfirmSecurityTests = (run: SecurityTestRequest, signal?: AbortSignal) => Promise<boolean>;

// The app's only, with the app's dialog: the headless server has nobody to ask
export function registerSecurityTestTools(server: McpServer, confirm: ConfirmSecurityTests) {
  server.tool(
    'run_security_tests',
    `Try an HTTP request's API for what one response can't show, as the Security tab's Run Security Tests does. Sends the request again up to ${SECURITY_TEST_MAX_REQUESTS} times, changed a little each time: without its credentials, with a token whose signature is wrong, with an unsigned token, as another user (otherEnvironmentId), from another origin, over plain http, with a quote in a query parameter, and several times in a row. Only a GET or HEAD request is tested, and nothing sent is stored. The app asks the user to allow each run; a declined run returns an error and sends nothing. Returns each test's outcome (found, passed, skipped, unclear) with a note, and the findings with their severity and OWASP API Security Top 10 risk. Findings of rules the collection ignores in the Security tab are left out, and named in ignoredRules. A test that passed found nothing this once; it does not show the API is secure.`,
    {
      requestId: z.string(),
      environmentId: z.string().nullable().optional().describe('Override the active environment for this call. Null = no environment overrides; omit = use workspace active environment.'),
      otherEnvironmentId: z.string().optional().describe("An environment holding another user's credentials: the request is sent once with them, to see whether that user gets the first user's data."),
    },
    async ({ requestId, environmentId, otherEnvironmentId }, { signal }) => {
      const request = await models.request.getById(requestId);
      if (!request || !isRequest(request)) {
        return notFound('HTTP request');
      }
      if (!isSafeToRepeat(request.method)) {
        return fail(`only a GET or HEAD request is tested: a ${request.method} would change things once more for every test`);
      }
      const workspace = await findWorkspaceForRequest(request.parentId);
      for (const id of [environmentId, otherEnvironmentId]) {
        const foreign = await foreignEnvironment(workspace?._id, id);
        if (foreign) {
          return fail(foreign);
        }
      }
      const allowed = await confirm({
        request: request.name,
        method: request.method,
        url: request.url,
        workspace: workspace?.name || '',
        requests: SECURITY_TEST_MAX_REQUESTS,
      }, signal);
      // a record of each answer, in the app's log
      console.log(`[mcp] run_security_tests ${requestId}: the user ${allowed === true ? 'allowed' : 'declined'} the run`);
      // only a plain yes sends anything
      if (allowed !== true) {
        return fail('the user declined to run the security tests');
      }
      try {
        const result = await runRequestSecurityTests(requestId, {
          ...(environmentId === undefined ? {} : { environmentId }),
          otherEnvironmentId,
          signal,
          // each URL the tests send to, as send_http_request checks its own
          checkUrl: assertSafeRequestUrl,
        });
        return json({ requestId, ...result, ...await withoutIgnoredSecurityRules(requestId, result.findings) });
      } catch (err) {
        return fail(`the security tests could not run: ${(err as Error).message}`);
      }
    },
  );
}
