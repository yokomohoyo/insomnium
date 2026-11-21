// The security checks over a whole folder or collection: each HTTP request in
// turn, as the response pane's Security tab does for one. A GET or HEAD is
// tested (security-tests.ts) and its answer looked at while it's there; any
// other request is never sent, so it gets what its last kept response showed.
// Nothing sent here is kept.
import { type AuditFinding, type AuditSeverity, auditStoredResponse, mostSevereFirst } from '../common/response-audit';
import { withoutIgnored } from '../common/security-rules';
import { isSafeToRepeat, SECURITY_TEST_MAX_REQUESTS, type SecurityCheck } from '../common/security-tests';
import * as models from '../models';
import { isEventStreamRequest } from '../models/request';
import type { RunnableRequest } from './runner';
import { runRequestSecurityTests, type SecurityTestOptions, type SecurityTestRun } from './security-tests';

export interface SecurityRunItem {
  requestId: string;
  name: string;
  // the folders it's in, outermost first
  folders: string[];
  method: string;
  // as sent, for a request that was; a credential in it is named by a finding, never shown here
  url: string;
  // tested: sent again and again, and its answer looked at; audited: its last
  // kept response looked at, nothing sent; skipped: neither, and note says why
  outcome: 'tested' | 'audited' | 'skipped';
  note?: string;
  // what the response showed, then what the tests found, most severe first
  findings: AuditFinding[];
  // each test and what it saw, for a request that was tested
  checks: SecurityCheck[];
  // how many requests were sent for it
  requests: number;
}

export interface SecurityRunSummary {
  items: SecurityRunItem[];
  // how many findings of each severity
  findings: Record<AuditSeverity, number>;
  // how many requests were sent in all
  requests: number;
  // stopped by its signal
  stopped: boolean;
}

export interface SecurityRunOptions extends Pick<SecurityTestOptions, 'environmentId' | 'otherEnvironmentId' | 'signal' | 'checkUrl'> {
  // the rules the collection ignores (common/security-rules.ts)
  ignored?: string[];
  onItem?: (item: SecurityRunItem) => void;
  // (the tests': replaced in tests)
  test?: (requestId: string, options: SecurityTestOptions) => Promise<SecurityTestRun>;
}

// the most a run over these requests may send: said before it starts
export const securityRunMaxRequests = (requests: RunnableRequest[]) =>
  requests.filter(({ request }) => isSafeToRepeat(request.method) && !isEventStreamRequest(request)).length * SECURITY_TEST_MAX_REQUESTS;

// a URL without its user name and password, and without its query's values
const shown = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    [...parsed.searchParams.keys()].forEach(name => parsed.searchParams.set(name, '…'));
    return decodeURIComponent(parsed.toString());
  } catch {
    return url;
  }
};

const count = (items: SecurityRunItem[]) => {
  const findings: Record<AuditSeverity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  items.forEach(item => item.findings.forEach(({ severity }) => findings[severity]++));
  return findings;
};

export async function runSecurityChecks(requests: RunnableRequest[], { ignored = [], onItem, signal, test = runRequestSecurityTests, ...options }: SecurityRunOptions = {}): Promise<SecurityRunSummary> {
  const items: SecurityRunItem[] = [];
  for (const { request, folders } of requests) {
    if (signal?.aborted) {
      break;
    }
    const item: SecurityRunItem = {
      requestId: request._id,
      name: request.name,
      folders,
      method: request.method,
      url: request.url,
      outcome: 'skipped',
      findings: [],
      checks: [],
      requests: 0,
    };
    if (isEventStreamRequest(request)) {
      item.note = "An event stream never ends, so it isn't sent.";
    } else if (isSafeToRepeat(request.method)) {
      try {
        const run = await test(request._id, { ...options, signal });
        item.outcome = 'tested';
        item.url = shown(run.url);
        item.checks = run.checks;
        item.requests = run.requests;
        item.findings = mostSevereFirst(withoutIgnored([...run.responseFindings, ...run.findings], ignored));
      } catch (err) {
        item.note = `It could not be tested: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      // never sent: it would change things. What its last kept response showed, if it has one
      const [latest] = (await models.response.findByParentId(request._id)).sort((a, b) => b.created - a.created);
      if (latest && !latest.error && latest.statusCode) {
        item.outcome = 'audited';
        item.url = shown(latest.url);
        item.note = `A ${request.method} isn't sent again: this is from its last response.`;
        item.findings = withoutIgnored(await auditStoredResponse(latest), ignored);
      } else {
        item.note = `A ${request.method} isn't sent again, and it has no response to look at: send it first.`;
      }
    }
    items.push(item);
    onItem?.(item);
  }
  return {
    items,
    findings: count(items),
    requests: items.reduce((sent, item) => sent + item.requests, 0),
    stopped: Boolean(signal?.aborted),
  };
}
