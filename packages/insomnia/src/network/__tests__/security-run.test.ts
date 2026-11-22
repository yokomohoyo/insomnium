import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../__jest__/before-each';
import type { AuditFinding } from '../../common/response-audit';
import * as models from '../../models';
import { listRunnableRequests } from '../runner';
import { securityJsonReport, securityMarkdownReport, securitySarifReport } from '../security-report';
import { runSecurityChecks, securityRunMaxRequests, type SecurityRunSummary } from '../security-run';
import type { SecurityTestOptions, SecurityTestRun } from '../security-tests';

window.app = electron.app;

const finding = (id: string, severity: AuditFinding['severity'], patch: Partial<AuditFinding> = {}): AuditFinding =>
  ({ id, severity, owasp: 'API8:2023 Security Misconfiguration', title: `Title of ${id}`, detail: `Detail of ${id}.`, ...patch });

const tested = (patch: Partial<SecurityTestRun> = {}): SecurityTestRun => ({
  url: 'https://shop.example.com/orders?token=s3cret&page=2',
  requests: 9,
  checks: [{ id: 'baseline', title: 'The request as it is', outcome: 'passed', note: 'It answered 200.' }],
  findings: [finding('no-credentials', 'high', { owasp: 'API2:2023 Broken Authentication' })],
  responseFindings: [finding('nosniff-missing', 'low'), finding('secret-in-url', 'medium', { evidence: 'token' })],
  ...patch,
});

describe('runSecurityChecks()', () => {
  let workspaceId: string;
  const test = jest.fn<(requestId: string, options: SecurityTestOptions) => Promise<SecurityTestRun>>();

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    test.mockReset().mockResolvedValue(tested());
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
  });

  const collection = async () => {
    const folder = await models.requestGroup.create({ parentId: workspaceId, name: 'Orders', metaSortKey: 1 });
    const list = await models.request.create({ parentId: folder._id, name: 'List', method: 'GET', url: 'https://shop.example.com/orders', metaSortKey: 1 });
    const create = await models.request.create({ parentId: folder._id, name: 'Create', method: 'POST', url: 'https://shop.example.com/orders', metaSortKey: 2 });
    const remove = await models.request.create({ parentId: folder._id, name: 'Delete', method: 'DELETE', url: 'https://shop.example.com/orders/7', metaSortKey: 3 });
    const events = await models.request.create({ parentId: workspaceId, name: 'Events', method: 'GET', url: 'https://shop.example.com/events', headers: [{ name: 'Accept', value: 'text/event-stream' }], metaSortKey: 2 });
    return { list, create, remove, events, requests: await listRunnableRequests(workspaceId) };
  };

  it('tests each GET, and gives it what its own answer showed with what the tests found, most severe first', async () => {
    const { list, requests } = await collection();

    const { items } = await runSecurityChecks(requests, { test, otherEnvironmentId: 'env_ben' });

    expect(test).toHaveBeenCalledTimes(1);
    expect(test).toHaveBeenCalledWith(list._id, expect.objectContaining({ otherEnvironmentId: 'env_ben' }));
    expect(items[0]).toMatchObject({ requestId: list._id, name: 'List', folders: ['Orders'], method: 'GET', outcome: 'tested', requests: 9 });
    expect(items[0].findings.map(({ id }) => id)).toEqual(['no-credentials', 'secret-in-url', 'nosniff-missing']);
    expect(items[0].checks).toHaveLength(1);
    // the URL as sent, without its query's values
    expect(items[0].url).toBe('https://shop.example.com/orders?token=…&page=…');
  });

  it('never sends a request that changes things: it gets what its last response showed, or a note that it has none', async () => {
    const { create, remove, requests } = await collection();
    await models.response.create({ parentId: create._id, statusCode: 201, url: 'http://shop.example.com/orders?api_key=k3y', headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Content-Type-Options', value: 'nosniff' }] });

    const { items } = await runSecurityChecks(requests, { test });

    expect(items[1]).toMatchObject({ requestId: create._id, outcome: 'audited', requests: 0, checks: [], note: "A POST isn't sent again: this is from its last response." });
    expect(items[1].findings.map(({ id }) => id)).toEqual(['plain-http', 'secret-in-url']);
    expect(items[1].url).toBe('http://shop.example.com/orders?api_key=…');
    expect(items[2]).toMatchObject({ requestId: remove._id, outcome: 'skipped', findings: [], note: "A DELETE isn't sent again, and it has no response to look at: send it first." });
  });

  it("doesn't send an event stream, and says why a request could not be tested", async () => {
    const { requests } = await collection();
    test.mockRejectedValue(new Error('The pre-request script failed: boom'));

    const { items } = await runSecurityChecks(requests, { test });

    expect(items[0]).toMatchObject({ outcome: 'skipped', failed: true, note: 'It could not be tested: The pre-request script failed: boom' });
    // (never sent by design isn't a failure)
    expect(items[1].failed).toBeUndefined();
    expect(items[3]).toMatchObject({ name: 'Events', outcome: 'skipped', note: "An event stream never ends, so it isn't sent." });
    expect(test).toHaveBeenCalledTimes(1);
  });

  it('leaves out the rules the collection ignores', async () => {
    const { requests } = await collection();

    const { items, findings } = await runSecurityChecks(requests, { test, ignored: ['nosniff-missing', 'no-credentials'] });

    expect(items[0].findings.map(({ id }) => id)).toEqual(['secret-in-url']);
    expect(findings).toEqual({ high: 0, medium: 1, low: 0, info: 0 });
  });

  it('counts the findings and the requests sent, and reports each request as it is done', async () => {
    const { requests } = await collection();
    const onItem = jest.fn();

    const summary = await runSecurityChecks(requests, { test, onItem });

    expect(summary.findings).toEqual({ high: 1, medium: 1, low: 1, info: 0 });
    expect(summary.requests).toBe(9);
    expect(summary.stopped).toBe(false);
    expect(onItem.mock.calls.map(([item]) => (item as { name: string }).name)).toEqual(['List', 'Create', 'Delete', 'Events']);
  });

  it('stops where it is when asked to', async () => {
    const { requests } = await collection();
    const controller = new AbortController();
    test.mockImplementation(async () => {
      controller.abort();
      return tested();
    });

    const summary = await runSecurityChecks(requests, { test, signal: controller.signal });

    expect(summary.items.map(({ name }) => name)).toEqual(['List']);
    expect(summary.stopped).toBe(true);
  });

  describe('with the design document\'s spec', () => {
    const SPEC = `
openapi: 3.0.0
info: { title: Shop, version: 1.0.0 }
paths:
  /orders:
    get: {}
    post: {}
  /orders/{id}:
    get: {}
`;

    it("flags the requests the spec doesn't describe, sent or not, and lists the operations no request covers", async () => {
      const { requests } = await collection();
      test.mockResolvedValue(tested({ findings: [], responseFindings: [] }));

      const { items, inventory, findings } = await runSecurityChecks(requests, { test, spec: SPEC });

      // GET /orders and POST /orders are the spec's; DELETE /orders/7 and GET /events are not
      expect(items.map(({ name, findings: found }) => [name, found.map(({ id, evidence }) => `${id}: ${evidence}`)])).toEqual([
        ['List', []],
        ['Create', []],
        ['Delete', ['not-in-spec: DELETE /orders/7']],
        ['Events', ['not-in-spec: GET /events']],
      ]);
      expect(items[2]).toMatchObject({ outcome: 'skipped', requests: 0 });
      expect(inventory).toEqual({ operations: 3, uncovered: ['GET /orders/{id}'] });
      expect(findings.low).toBe(2);
    });

    it('leaves the rule out when the collection ignores it, and still lists what has no request', async () => {
      const { requests } = await collection();
      test.mockResolvedValue(tested({ findings: [], responseFindings: [] }));

      const { items, inventory } = await runSecurityChecks(requests, { test, spec: SPEC, ignored: ['not-in-spec'] });

      expect(items.flatMap(item => item.findings)).toEqual([]);
      expect(inventory?.uncovered).toEqual(['GET /orders/{id}']);
    });

    it("counts the rest of the document's requests as covering operations, when the run is over one folder", async () => {
      const { create, requests } = await collection();
      test.mockResolvedValue(tested({ findings: [], responseFindings: [] }));
      // the run is the POST alone; the GET in the same document covers GET /orders
      const folder = requests.filter(({ request }) => request._id === create._id);

      const alone = await runSecurityChecks(folder, { test, spec: SPEC });
      expect(alone.inventory?.uncovered).toEqual(['GET /orders', 'GET /orders/{id}']);

      const within = await runSecurityChecks(folder, { test, spec: SPEC, covering: requests });
      expect(within.inventory).toEqual({ operations: 3, uncovered: ['GET /orders/{id}'] });
      // (and only the run's requests are checked, or flagged)
      expect(within.items.map(({ name }) => name)).toEqual(['Create']);
    });

    it('has no inventory without a spec, or with something that is not one', async () => {
      const { requests } = await collection();

      expect((await runSecurityChecks(requests, { test })).inventory).toBeUndefined();
      expect((await runSecurityChecks(requests, { test, spec: 'not: a spec' })).inventory).toBeUndefined();
    });
  });

  describe('with requests marked as for some users only', () => {
    // Admin (marked) > Reports > Revenue; Admin > Audit; and Public, not marked
    const marked = async () => {
      const admin = await models.requestGroup.create({ parentId: workspaceId, name: 'Admin', metaSortKey: 1, securityRestricted: true });
      const reports = await models.requestGroup.create({ parentId: admin._id, name: 'Reports', metaSortKey: 1 });
      const revenue = await models.request.create({ parentId: reports._id, name: 'Revenue', url: 'https://shop.example.com/admin/revenue', metaSortKey: 1 });
      const audit = await models.request.create({ parentId: admin._id, name: 'Audit', url: 'https://shop.example.com/admin/audit', metaSortKey: 2 });
      const open = await models.request.create({ parentId: workspaceId, name: 'Public', url: 'https://shop.example.com/products', metaSortKey: 2 });
      const own = await models.request.create({ parentId: workspaceId, name: 'Settings', url: 'https://shop.example.com/settings', metaSortKey: 3, securityRestricted: true });
      return { admin, reports, revenue, audit, open, own };
    };

    it("lists a request as restricted when it is marked, or a folder it's in is, however deep", async () => {
      const { reports } = await marked();

      expect((await listRunnableRequests(workspaceId)).map(({ request, restricted }) => [request.name, Boolean(restricted)]))
        .toEqual([['Revenue', true], ['Audit', true], ['Public', false], ['Settings', true]]);
      // and from a folder inside the marked one, where the marker is above what's listed
      expect((await listRunnableRequests(reports._id)).map(({ request, restricted }) => [request.name, restricted])).toEqual([['Revenue', true]]);
    });

    it('tries less privilege on the marked requests alone', async () => {
      await marked();
      test.mockResolvedValue(tested({ findings: [], responseFindings: [] }));

      const summary = await runSecurityChecks(await listRunnableRequests(workspaceId), { test, lowerEnvironmentId: 'env_viewer' });

      expect(test.mock.calls.map(([, options]) => options.lowerEnvironmentId)).toEqual(['env_viewer', 'env_viewer', null, 'env_viewer']);
      expect(summary.items.map(({ name, restricted }) => [name, Boolean(restricted)])).toEqual([['Revenue', true], ['Audit', true], ['Public', false], ['Settings', true]]);
      expect(summary.restrictedUntried).toBe(0);
    });

    it('says how many marked requests went untried when no environment was chosen for it', async () => {
      await marked();
      test.mockResolvedValue(tested({ findings: [], responseFindings: [] }));

      const summary = await runSecurityChecks(await listRunnableRequests(workspaceId), { test });

      expect(summary.restrictedUntried).toBe(3);
    });

    it('tries it on every request when none is marked, as choosing the environment then says they are', async () => {
      const { requests } = await collection();
      test.mockResolvedValue(tested({ findings: [], responseFindings: [] }));

      const summary = await runSecurityChecks(requests, { test, lowerEnvironmentId: 'env_viewer' });

      expect(test).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ lowerEnvironmentId: 'env_viewer' }));
      expect(summary.restrictedUntried).toBe(0);
    });
  });

  it('says beforehand the most it may send: the tests of each GET and HEAD', async () => {
    const { requests } = await collection();

    // (the event stream is a GET too, and isn't sent)
    expect(securityRunMaxRequests(requests)).toBe(111);
    expect(securityRunMaxRequests([])).toBe(0);
    // fewer or more with another burst, none of it with 0
    expect(securityRunMaxRequests(requests, 15)).toBe(26);
    expect(securityRunMaxRequests(requests, 0)).toBe(11);
  });
});

describe('the reports', () => {
  const summary: SecurityRunSummary = {
    requests: 9,
    stopped: false,
    restrictedUntried: 0,
    findings: { high: 1, medium: 1, low: 0, info: 0 },
    items: [
      {
        requestId: 'req_1',
        name: 'List',
        folders: ['Orders'],
        method: 'GET',
        url: 'https://shop.example.com/orders?token=…',
        outcome: 'tested',
        requests: 9,
        checks: [{ id: 'no-credentials', title: 'Without its credentials', outcome: 'found', note: 'It answered 200. The answer was the same | as with credentials.' }],
        findings: [
          finding('no-credentials', 'high', { owasp: 'API2:2023 Broken Authentication', title: 'It answers the same without credentials' }),
          finding('secret-in-url', 'medium', { evidence: 'token', title: 'A credential in the URL' }),
        ],
      },
      { requestId: 'req_2', name: 'Create', folders: ['Orders'], method: 'POST', url: 'https://shop.example.com/orders', outcome: 'skipped', requests: 0, checks: [], findings: [], note: "A POST isn't sent again, and it has no response to look at: send it first." },
    ],
  };
  const at = new Date('2026-11-21T10:00:00Z');

  it('as JSON, is the run as it is, with its name and when', () => {
    const report = JSON.parse(securityJsonReport(summary, 'Shop', at));

    expect(report).toMatchObject({ name: 'Shop', generated: '2026-11-21T10:00:00.000Z', requests: 9, findings: { high: 1, medium: 1 } });
    expect(report.items).toEqual(summary.items);
  });

  it('as Markdown, has the findings most severe first, what each means, and each request with its tests', () => {
    const report = securityMarkdownReport(summary, 'Shop', at);

    expect(report).toContain('# Security checks: Shop');
    expect(report).toContain('2 requests: 1 tested, 0 checked from their last response, 1 not checked. 9 requests were sent.');
    expect(report).toContain('Findings: 1 high, 1 medium.');
    expect(report).toContain('| High | It answers the same without credentials |  | Orders / List (GET https://shop.example.com/orders?token=…) | API2:2023 Broken Authentication |');
    expect(report).toContain('| Medium | A credential in the URL | `token` |');
    expect(report.indexOf('| High |')).toBeLessThan(report.indexOf('| Medium |'));
    expect(report).toContain('- **It answers the same without credentials.** Detail of no-credentials.');
    // a pipe in a note doesn't break the table
    expect(report).toContain('| Without its credentials | found | It answered 200. The answer was the same \\| as with credentials. |');
    expect(report).toContain("### Orders / Create (POST https://shop.example.com/orders)\n\nA POST isn't sent again");
    expect(report.endsWith('\n')).toBe(true);
  });

  it("as Markdown and JSON, has what the spec's operations lack for requests", () => {
    const withInventory = { ...summary, inventory: { operations: 4, uncovered: ['GET /orders/{id}', 'DELETE /orders/{id}'] } };
    const report = securityMarkdownReport(withInventory, 'Shop', at);

    expect(report).toContain("## Against the spec\n\nThe spec has 4 operations; 2 have no request, so the checks didn't reach them:\n\n- `GET /orders/{id}`\n- `DELETE /orders/{id}`");
    expect(report.indexOf('## Against the spec')).toBeLessThan(report.indexOf('## Requests'));
    expect(securityMarkdownReport({ ...summary, inventory: { operations: 1, uncovered: [] } }, 'Shop', at)).toContain('The spec has 1 operation; each has a request.');
    expect(securityMarkdownReport(summary, 'Shop', at)).not.toContain('## Against the spec');
    expect(JSON.parse(securityJsonReport(withInventory, 'Shop', at)).inventory).toEqual(withInventory.inventory);
  });

  it('as Markdown, says so when nothing was found', () => {
    const clean = { ...summary, findings: { high: 0, medium: 0, low: 0, info: 0 }, items: [{ ...summary.items[0], findings: [] }] };
    const report = securityMarkdownReport(clean, 'Shop', at);

    expect(report).toContain('Findings: none.');
    expect(report).not.toContain('## Findings');
    expect(report).toContain('Nothing found.');
  });

  it('as SARIF, has a rule for each kind of finding and a result for each finding, at the request it was found in', () => {
    const { version, runs: [run] } = JSON.parse(securitySarifReport(summary, 'Shop', '0.10.0'));

    expect(version).toBe('2.1.0');
    expect(run.tool.driver).toMatchObject({ name: 'Insomnium', version: '0.10.0' });
    expect(run.tool.driver.rules.map(({ id, defaultConfiguration }: { id: string; defaultConfiguration: { level: string } }) => [id, defaultConfiguration.level]))
      .toEqual([['no-credentials', 'error'], ['secret-in-url', 'warning']]);
    expect(run.tool.driver.rules[0]).toMatchObject({ name: 'It answers the same without credentials', properties: { tags: ['security', 'API2:2023 Broken Authentication'], 'security-severity': '8.0' } });
    expect(run.results).toHaveLength(2);
    expect(run.results[1]).toMatchObject({
      ruleId: 'secret-in-url',
      level: 'warning',
      locations: [{ logicalLocations: [{ name: 'GET https://shop.example.com/orders?token=…', fullyQualifiedName: 'Orders/List', kind: 'resource' }] }],
      partialFingerprints: { 'insomnium/v1': 'secret-in-url:req_1:token' },
    });
    expect(run.results[1].message.text).toContain('A credential in the URL (token)');
  });
});
