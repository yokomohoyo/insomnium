import { describe, expect, it } from '@jest/globals';

import type { AuditFinding } from '../../common/response-audit';
import { baselineMatcher, compareWithBaseline, readBaseline } from '../security-baseline';
import { securityJsonReport, securityMarkdownReport, securitySarifReport } from '../security-report';
import type { SecurityRunItem, SecurityRunSummary } from '../security-run';

const finding = (id: string, severity: AuditFinding['severity'], evidence?: string): AuditFinding =>
  ({ id, severity, owasp: 'API8:2023 Security Misconfiguration', title: `Title of ${id}`, detail: `Detail of ${id}.`, ...(evidence ? { evidence } : {}) });
const item = (requestId: string, findings: AuditFinding[], patch: Partial<SecurityRunItem> = {}): SecurityRunItem =>
  ({ requestId, name: requestId, folders: ['Orders'], method: 'GET', url: `https://api.example.com/${requestId}`, outcome: 'tested', findings, checks: [], requests: 9, ...patch });
const summary = (items: SecurityRunItem[]): SecurityRunSummary => {
  const findings = { high: 0, medium: 0, low: 0, info: 0 };
  items.forEach(({ findings: found }) => found.forEach(({ severity }) => findings[severity]++));
  return { items, findings, requests: 9 * items.length, stopped: false, restrictedUntried: 0 };
};
// an earlier run's report, as --json writes it
const reportOf = (items: SecurityRunItem[]) => securityJsonReport(summary(items), 'Shop', new Date(0));

describe('readBaseline()', () => {
  it("reads an earlier JSON report's findings", () => {
    expect(readBaseline(reportOf([item('list', [finding('no-credentials', 'high'), finding('cookie-flags', 'low', 'sid')]), item('get', [])]))).toEqual([
      { key: 'GET Orders / list', id: 'no-credentials', title: 'Title of no-credentials', request: 'Orders / list' },
      { key: 'GET Orders / list', id: 'cookie-flags', evidence: 'sid', title: 'Title of cookie-flags', request: 'Orders / list' },
    ]);
  });

  it("refuses what isn't one, rather than read it as a run with nothing found", () => {
    expect(() => readBaseline('not json')).toThrow('it is not JSON');
    expect(() => readBaseline('{"runs":[]}')).toThrow('it is not a security report');
    expect(() => readBaseline('null')).toThrow('it is not a security report');
    expect(() => readBaseline('{"items":[{"name":"x"}]}')).toThrow('a request in it has no name, no method or no findings');
    expect(readBaseline('{"items":[]}')).toEqual([]);
  });
});

describe('compareWithBaseline()', () => {
  it('tells the findings an earlier run had from the new ones', () => {
    const baseline = readBaseline(reportOf([item('list', [finding('no-credentials', 'high'), finding('nosniff-missing', 'low')])]));
    const run = summary([item('list', [finding('no-credentials', 'high'), finding('token-unsigned', 'high'), finding('nosniff-missing', 'low')]), item('get', [finding('nosniff-missing', 'low')])]);

    expect(compareWithBaseline(run, baseline)).toEqual({ known: 2, fresh: { high: 1, medium: 0, low: 1, info: 0 }, fixed: [] });
    expect(run.items[0].findings.map(({ id, known }) => [id, known])).toEqual([['no-credentials', true], ['token-unsigned', undefined], ['nosniff-missing', true]]);
    // the same rule on another request is new
    expect(run.items[1].findings[0].known).toBeUndefined();
  });

  it('lists what the baseline had that the run looked for and no longer finds', () => {
    const baseline = readBaseline(reportOf([
      item('list', [finding('no-credentials', 'high'), finding('nosniff-missing', 'low')]),
      item('other-folder', [finding('no-credentials', 'high')]),
      item('unreachable', [finding('no-credentials', 'high')]),
    ]));
    const run = summary([item('list', [finding('nosniff-missing', 'low')]), item('unreachable', [], { outcome: 'skipped', failed: true })]);

    expect(compareWithBaseline(run, baseline)).toEqual({
      known: 1,
      fresh: { high: 0, medium: 0, low: 0, info: 0 },
      // not the request another folder holds, nor the one that couldn't be tested: neither was looked at
      fixed: [{ key: 'GET Orders / list', id: 'no-credentials', title: 'Title of no-credentials', request: 'Orders / list' }],
    });
  });

  it('knows a finding whose evidence changed, and counts a second one of the same rule as new', () => {
    const baseline = readBaseline(reportOf([item('list', [finding('rate-limit', 'low', '15 requests in a row'), finding('cookie-flags', 'low', 'sid')])]));
    const run = summary([item('list', [
      finding('rate-limit', 'low', '100 requests in a row'),
      // a new cookie with the fault, listed before the one the baseline has
      finding('cookie-flags', 'low', 'cart'),
      finding('cookie-flags', 'low', 'sid'),
    ])]);

    expect(compareWithBaseline(run, baseline)).toMatchObject({ known: 2, fresh: { low: 1 }, fixed: [] });
    expect(run.items[0].findings.map(({ evidence, known }) => [evidence, Boolean(known)])).toEqual([['100 requests in a row', true], ['cart', false], ['sid', true]]);
  });

  it('can be told of each request as the run goes', () => {
    const matcher = baselineMatcher(readBaseline(reportOf([item('list', [finding('no-credentials', 'high')])])));
    const first = item('list', [finding('no-credentials', 'high')]);
    matcher.mark(first);

    expect(first.findings[0].known).toBe(true);
    expect(matcher.result()).toMatchObject({ known: 1, fixed: [] });
  });
});

describe('the reports, against a baseline', () => {
  const baseline = readBaseline(reportOf([item('list', [finding('no-credentials', 'high'), finding('hsts-missing', 'low')])]));
  const run = summary([item('list', [finding('no-credentials', 'high'), finding('token-unsigned', 'high')])]);
  const comparison = compareWithBaseline(run, baseline);

  it('says in Markdown which findings are new, the new ones first, and what is gone', () => {
    const markdown = securityMarkdownReport(run, 'Shop', new Date(0), comparison);

    expect(markdown).toContain('Against the baseline: 1 new, 1 known, 1 no longer found.');
    expect(markdown).toContain('| Severity | Baseline | Finding | Where | Request | Risk |');
    expect(markdown.indexOf('| High | **New** | Title of token-unsigned |')).toBeGreaterThan(0);
    expect(markdown.indexOf('| High | **New** |')).toBeLessThan(markdown.indexOf('| High | Known | Title of no-credentials |'));
    expect(markdown).toContain('## No longer found');
    expect(markdown).toContain('- Title of hsts-missing: Orders / list');
    // and nothing of it without one
    expect(securityMarkdownReport(run, 'Shop', new Date(0))).not.toContain('Baseline');
  });

  it('says so in JSON, in a report that is itself a baseline', () => {
    const json = securityJsonReport(run, 'Shop', new Date(0), comparison);

    expect(JSON.parse(json).baseline).toEqual({ new: { high: 1, medium: 0, low: 0, info: 0 }, known: 1, fixed: [{ key: 'GET Orders / list', id: 'hsts-missing', title: 'Title of hsts-missing', request: 'Orders / list' }] });
    expect(readBaseline(json).map(({ id }) => id)).toEqual(['no-credentials', 'token-unsigned']);
    expect(JSON.parse(securityJsonReport(run, 'Shop', new Date(0)))).not.toHaveProperty('baseline');
  });

  it('gives each SARIF result its baseline state', () => {
    const results = JSON.parse(securitySarifReport(run, 'Shop', '1.0.0', comparison)).runs[0].results;

    expect(results.map(({ ruleId, baselineState }: { ruleId: string; baselineState: string }) => [ruleId, baselineState])).toEqual([['no-credentials', 'unchanged'], ['token-unsigned', 'new']]);
    expect(JSON.parse(securitySarifReport(run, 'Shop', '1.0.0')).runs[0].results[0]).not.toHaveProperty('baselineState');
  });
});
