// Runs a request's security tests (common/security-tests.ts decides what to
// send and what the answers mean): renders the request as Send does, then
// sends each variant of it. Nothing sent here is kept: no response in the
// history, no cookie in the jar.
import fs from 'node:fs';

import clone from 'clone';

import { getRenderedRequestAndContext, type RenderedRequest } from '../common/render';
import { type AuditFinding, auditResponse, sentRequest } from '../common/response-audit';
import { CREDENTIAL_HEADER, type ProbeExchange, type ProbeVariant, runSecurityTests, type SecurityTestResult } from '../common/security-tests';
import { isRequest } from '../models/request';
import { getBoundedBodyBuffer } from '../models/response';
import { runPreRequestScript } from '../scripting/request-scripts';
import { getAuthHeaders, getAuthQueryParamsList } from './authentication';
import { cancelCurlAndWriteTimeline, fetchRequestData, sendCurlAndWriteTimeline, transformUrl } from './network';

// as much of each answer as is compared
const BODY_BYTES = 256 * 1024;

export interface SecurityTestOptions {
  // in place of the workspace's active environment
  environmentId?: string | null;
  // an environment with another user's credentials, to send the request as
  otherEnvironmentId?: string | null;
  signal?: AbortSignal;
  // throws for a URL that mustn't be sent to (the MCP server's guard)
  checkUrl?: (url: string) => void;
}

// A request's tests, with what its own answer showed (response-audit.ts) while
// it was there to look at: a run over a collection reports both
export interface SecurityTestRun extends SecurityTestResult {
  // empty when the request itself got no answer
  responseFindings: AuditFinding[];
  // the request's URL as sent, without what its auth adds to the query
  url: string;
}

const remove = (path?: string) => path ? fs.promises.rm(path, { force: true }).catch(() => undefined) : undefined;

export async function runRequestSecurityTests(requestId: string, { environmentId, otherEnvironmentId, signal, checkUrl }: SecurityTestOptions = {}): Promise<SecurityTestRun> {
  const { request, environment, settings, clientCertificates, caCert } = await fetchRequestData(requestId);
  if (!isRequest(request)) {
    throw new Error('Only an HTTP request has security tests');
  }
  const envId = environmentId === undefined ? environment._id : environmentId || '';
  // the pre-request script first, as Send runs it
  const scripted = await runPreRequestScript(request, { environmentId: envId || null });
  const render = async (id: string) => (await getRenderedRequestAndContext({ request: scripted.request, environmentId: id, iterationData: scripted.variables })).request;
  const base = await render(envId);
  const other = otherEnvironmentId ? await render(otherEnvironmentId) : null;

  // the URL every variant starts from: the request's own, before its auth adds to it
  const { finalUrl: url, socketPath } = transformUrl(base.url, base.parameters, base.segmentParams, [], base.settingEncodeUrl);
  if (socketPath) {
    throw new Error("A request to a unix socket isn't tested");
  }

  // what the request's own answer shows, from the first time it's sent as it is
  let responseFindings: AuditFinding[] | undefined;
  const send = async (variant: ProbeVariant): Promise<ProbeExchange> => {
    const probe: RenderedRequest = clone(variant.asOther && other ? other : base);
    probe.url = variant.url || url;
    probe.parameters = [];
    probe.segmentParams = [];
    // one answer at a time, and nothing kept from it
    probe.settingFollowRedirects = 'off';
    probe.settingStoreCookies = false;
    if (variant.withoutCredentials) {
      probe.authentication = {};
      probe.settingSendCookies = false;
      probe.cookies = [];
      probe.headers = probe.headers.filter(({ name }) => !CREDENTIAL_HEADER.test(name));
    }
    const replaced = Object.keys(variant.headers || {}).map(name => name.toLowerCase());
    if (replaced.includes('authorization')) {
      // what the auth would send, here rather than in the send, so the
      // variant's Authorization is the one that goes
      const { finalUrl } = transformUrl(probe.url, [], [], probe.authentication, probe.settingEncodeUrl);
      probe.headers.push(...await getAuthHeaders(probe, finalUrl));
      probe.url = finalUrl;
      probe.authentication = {};
    }
    probe.headers = [
      ...probe.headers.filter(({ name }) => !replaced.includes(name.toLowerCase())),
      ...Object.entries(variant.headers || {}).map(([name, value]) => ({ name, value })),
    ];
    checkUrl?.(transformUrl(probe.url, [], [], probe.authentication, probe.settingEncodeUrl).finalUrl);
    if (signal?.aborted) {
      throw new Error('Stopped');
    }

    const response = await sendCurlAndWriteTimeline(probe, clientCertificates, caCert, settings);
    try {
      let timeline: { name: string; value: string }[] = [];
      try {
        timeline = response.timelinePath ? JSON.parse(await fs.promises.readFile(response.timelinePath, 'utf8')) : [];
      } catch {
        // compared without what was sent
      }
      const { headers: sent } = sentRequest(timeline);
      if ('error' in response && response.error) {
        return { statusCode: 0, headers: [], body: '', sent, error: response.error };
      }
      const answer = response as { statusCode?: number; headers?: { name: string; value: string }[]; bodyPath?: string; bodyCompression?: 'zip' | null };
      const body = answer.bodyPath ? (await getBoundedBodyBuffer(answer, BODY_BYTES)).buffer.toString('utf8') : '';
      if (!responseFindings && !Object.keys(variant).length) {
        responseFindings = auditResponse({
          url: ('url' in response && response.url) || url,
          statusCode: answer.statusCode || 0,
          headers: answer.headers || [],
          contentType: 'contentType' in response ? response.contentType : undefined,
          body,
          timeline,
        });
      }
      return { statusCode: answer.statusCode || 0, headers: answer.headers || [], body, sent };
    } finally {
      await remove(response.timelinePath);
      await remove('bodyPath' in response ? response.bodyPath : undefined);
    }
  };

  const stop = () => {
    cancelCurlAndWriteTimeline(base._id).catch(() => undefined);
  };
  signal?.addEventListener('abort', stop);
  try {
    const result = await runSecurityTests({
      method: base.method,
      url,
      credentialInQuery: getAuthQueryParamsList(base.authentication).length > 0,
      hasOther: Boolean(other),
      send,
      signal,
    });
    return { ...result, responseFindings: responseFindings || [], url };
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}
