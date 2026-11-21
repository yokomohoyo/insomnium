import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ignoredRules } from '../../../common/security-rules';
import { isSafeToRepeat, SECURITY_TEST_MAX_REQUESTS } from '../../../common/security-tests';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import { listRunnableRequests } from '../../../network/runner';
import { runSecurityChecks, securityRunMaxRequests } from '../../../network/security-run';
import { runRequestSecurityTests } from '../../../network/security-tests';
import { assertSafeRequestUrl, fail, findWorkspaceForRequest, foreignEnvironment, json, notFound, withoutIgnoredSecurityRules } from './util';

// What the user is asked before a run: the tests send the request again, up
// to `requests` times, each changed to see what the API lets through, and a
// client mustn't point that at an API on the user's behalf unasked
export interface SecurityTestRequest {
  // the request's name, or the folder's or collection's when it's all of theirs
  request: string;
  // one request's
  method?: string;
  url?: string;
  // how many requests are checked, for a folder or collection
  count?: number;
  workspace: string;
  // the most that may be sent
  requests: number;
}
// the signal is the MCP request's: a run the client gives up on is a no
export type ConfirmSecurityTests = (run: SecurityTestRequest, signal?: AbortSignal) => Promise<boolean>;

// The app's only, with the app's dialog: the headless server has nobody to ask
export function registerSecurityTestTools(server: McpServer, confirm: ConfirmSecurityTests) {
  server.tool(
    'run_security_tests',
    `Try an HTTP request's API for what one response can't show, as the Security tab's Run Security Tests does. Sends the request again up to ${SECURITY_TEST_MAX_REQUESTS} times, changed a little each time: without its credentials, with a token whose signature is wrong, with an unsigned token, as another user (otherEnvironmentId), as a user with less privilege (lowerEnvironmentId), from another origin, over plain http, with a quote in a query parameter, and several times in a row. Only a GET or HEAD request is tested, and nothing sent is stored. The app asks the user to allow each run; a declined run returns an error and sends nothing. Returns each test's outcome (found, passed, skipped, unclear) with a note, and the findings with their severity and OWASP API Security Top 10 risk. Findings of rules the collection ignores in the Security tab are left out, and named in ignoredRules. A test that passed found nothing this once; it does not show the API is secure.`,
    {
      requestId: z.string(),
      environmentId: z.string().nullable().optional().describe('Override the active environment for this call. Null = no environment overrides; omit = use workspace active environment.'),
      otherEnvironmentId: z.string().optional().describe("An environment holding another user's credentials: the request is sent once with them, to see whether that user gets the first user's data."),
      lowerEnvironmentId: z.string().optional().describe('For a request only some users may make (an admin function): an environment whose user may not. The request is sent once with their credentials, and anything but a refusal is a finding.'),
    },
    async ({ requestId, environmentId, otherEnvironmentId, lowerEnvironmentId }, { signal }) => {
      const request = await models.request.getById(requestId);
      if (!request || !isRequest(request)) {
        return notFound('HTTP request');
      }
      if (!isSafeToRepeat(request.method)) {
        return fail(`only a GET or HEAD request is tested: a ${request.method} would change things once more for every test`);
      }
      const workspace = await findWorkspaceForRequest(request.parentId);
      for (const id of [environmentId, otherEnvironmentId, lowerEnvironmentId]) {
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
        const { checks, findings, requests } = await runRequestSecurityTests(requestId, {
          ...(environmentId === undefined ? {} : { environmentId }),
          otherEnvironmentId,
          lowerEnvironmentId,
          signal,
          // each URL the tests send to, as send_http_request checks its own
          checkUrl: assertSafeRequestUrl,
        });
        return json({ requestId, checks, requests, ...await withoutIgnoredSecurityRules(requestId, findings) });
      } catch (err) {
        return fail(`the security tests could not run: ${(err as Error).message}`);
      }
    },
  );

  server.tool(
    'run_security_checks',
    `Run the security checks over every HTTP request in a workspace or folder (parentId), as the app's Security Checks does. Each GET or HEAD is tested as run_security_tests does (up to ${SECURITY_TEST_MAX_REQUESTS} requests each) and its answer audited as audit_response does; any other request is never sent, and gets what its last response showed. Nothing sent is stored. The app asks the user to allow each run, saying how many requests it may send; a declined run returns an error and sends nothing. Returns each request with its outcome (tested, audited, skipped), findings and tests, the count of findings by severity, and how many requests were sent. For a design document the requests are also compared with its spec: a request the spec doesn't describe is a finding, and inventory lists the spec's operations no request covers. Rules the collection ignores are left out.`,
    {
      parentId: z.string().describe('a workspace or folder id'),
      otherEnvironmentId: z.string().optional().describe("An environment holding another user's credentials: each tested request is also sent once with them."),
      lowerEnvironmentId: z.string().optional().describe('For a folder of requests only some users may make: an environment whose user may not. Each tested request is also sent once with their credentials, and anything but a refusal is a finding.'),
    },
    async ({ parentId, otherEnvironmentId, lowerEnvironmentId }, { signal }) => {
      const parent = await models.workspace.getById(parentId) || await models.requestGroup.getById(parentId);
      if (!parent) {
        return notFound('workspace or folder');
      }
      const requests = await listRunnableRequests(parentId);
      if (!requests.length) {
        return fail('no HTTP requests under parentId');
      }
      const workspace = await findWorkspaceForRequest(parentId);
      for (const id of [otherEnvironmentId, lowerEnvironmentId]) {
        const foreign = await foreignEnvironment(workspace?._id, id);
        if (foreign) {
          return fail(foreign);
        }
      }
      const allowed = await confirm({
        request: parent.name,
        count: requests.length,
        workspace: workspace && workspace._id !== parent._id ? workspace.name : '',
        requests: securityRunMaxRequests(requests),
      }, signal);
      console.log(`[mcp] run_security_checks ${parentId}: the user ${allowed === true ? 'allowed' : 'declined'} the run`);
      if (allowed !== true) {
        return fail('the user declined to run the security checks');
      }
      const ignored = ignoredRules(workspace?.securityIgnoredRules);
      // a design document's requests are also compared with its spec
      const spec = workspace?.scope === 'design' ? (await models.apiSpec.getByParentId(workspace._id))?.contents : undefined;
      const summary = await runSecurityChecks(requests, { otherEnvironmentId, lowerEnvironmentId, ignored, spec, signal, checkUrl: assertSafeRequestUrl });
      return json({ parentId, ...summary, ...(ignored.length ? { ignoredRules: ignored } : {}) });
    },
  );
}
