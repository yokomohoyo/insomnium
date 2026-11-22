import { describe, expect, it } from '@jest/globals';

import type { AuditFinding } from '../../common/response-audit';
import { compareWithBaseline, readBaseline } from '../security-baseline';
import { securityJsonReport } from '../security-report';
import { securityHtmlReport } from '../security-report-html';
import type { SecurityRunItem, SecurityRunSummary } from '../security-run';

const finding = (id: string, severity: AuditFinding['severity'], patch: Partial<AuditFinding> = {}): AuditFinding =>
  ({ id, severity, owasp: 'API8:2023 Security Misconfiguration', title: `Title of ${id}`, detail: `Detail of ${id}.`, ...patch });
const item = (name: string, findings: AuditFinding[], patch: Partial<SecurityRunItem> = {}): SecurityRunItem =>
  ({ requestId: `req_${name}`, name, folders: ['Orders'], method: 'GET', url: `https://shop.example.com/${name}`, outcome: 'tested', findings, checks: [], requests: 9, ...patch });
const summary = (items: SecurityRunItem[], patch: Partial<SecurityRunSummary> = {}): SecurityRunSummary => {
  const findings = { high: 0, medium: 0, low: 0, info: 0 };
  items.forEach(({ findings: found }) => found.forEach(({ severity }) => findings[severity]++));
  return { items, findings, requests: 18, stopped: false, restrictedUntried: 0, ...patch };
};
const at = new Date('2026-11-22T10:00:00Z');

describe('securityHtmlReport()', () => {
  const run = summary([
    item('list', [finding('no-credentials', 'high', { owasp: 'API2:2023 Broken Authentication' }), finding('secret-in-url', 'medium', { evidence: 'token' })], {
      restricted: true,
      checks: [{ id: 'no-credentials', title: 'Without its credentials', outcome: 'found', note: 'It answered 200.' }, { id: 'rate-limit', title: '100 times in a row', outcome: 'passed', note: 'It answered 429 to request 61.' }],
    }),
    item('create', [], { method: 'POST', outcome: 'skipped', note: "A POST isn't sent again, and it has no response to look at: send it first." }),
    item('get', []),
  ]);

  it('is one page with the counts, the findings most severe first, what each means, and each request with its tests', () => {
    const html = securityHtmlReport(run, 'Shop', at);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Security checks: Shop</title>');
    expect(html).toContain('2026-11-22T10:00:00.000Z. 3 requests: 2 tested, 0 checked from their last response, 1 not checked. 18 requests were sent.');
    expect(html).toContain('<div class="tile"><b class="high">1</b>High</div>');
    expect(html).toContain('<div class="tile"><b class="faint">0</b>Low</div>');
    expect(html.indexOf('Title of no-credentials')).toBeLessThan(html.indexOf('Title of secret-in-url'));
    expect(html).toContain('<code>token</code>');
    expect(html).toContain('<li><strong>Title of secret-in-url.</strong> Detail of secret-in-url.</li>');
    expect(html).toContain('<strong>Orders / list</strong> <span class="badge info">Restricted</span> <span class="badge high">2 findings</span>');
    expect(html).toContain('<td>100 times in a row</td><td class="ok">Passed</td><td>It answered 429 to request 61.</td>');
    expect(html).toContain('<span class="badge info">Not checked</span>');
    expect(html).toContain('A POST isn&#39;t sent again');
    expect(html).toContain('<span class="badge ok">Nothing found</span>');
    // the requests with something to read start open, the rest closed
    expect(html.match(/<details open>/g)).toHaveLength(1);
    expect(html.match(/<details>/g)).toHaveLength(2);
  });

  it('stands alone: it loads and runs nothing', () => {
    const html = securityHtmlReport(run, 'Shop', at);

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link|<img|@import|url\(/i);
    expect(html.match(/https?:\/\/[^"<\s]+/g)?.filter(url => !url.startsWith('https://shop.example.com/'))).toEqual(['https://owasp.org/API-Security/editions/2023/en/0x11-t10/']);
  });

  it('shows what came from the collection and the API as text, never as markup', () => {
    const hostile = summary([item('<img src=x onerror=alert(1)>', [finding('reflected', 'low', { title: '<script>alert(1)</script>', evidence: '"><b>', detail: 'a & b' })], {
      folders: ['<b>Orders</b>'],
      url: 'https://shop.example.com/?q=<svg/onload=1>',
      note: '</p><script>x</script>',
      checks: [{ id: 'c', title: '<i>t</i>', outcome: 'unclear', note: "it's <u>odd</u>" }],
    })]);
    const html = securityHtmlReport(hostile, '</title><script>alert(1)</script>', at);

    expect(html).not.toMatch(/<script|<img|<svg|<b>|<i>|<u>/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<code>&quot;&gt;&lt;b&gt;</code>');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('it&#39;s &lt;u&gt;odd&lt;/u&gt;');
  });

  it('says so when nothing was found, when the run was stopped, and when a request could not be tested', () => {
    const html = securityHtmlReport(summary([item('get', []), item('down', [], { outcome: 'skipped', failed: true, note: 'It could not be tested: refused' })], { stopped: true }), 'Shop', at);

    expect(html).toContain('<p class="ok">Nothing found.</p>');
    expect(html).toContain('and the run was stopped before the end');
    expect(html).toContain('<span class="badge high">Could not be tested</span>');
    expect(html).not.toContain('What each means');
  });

  it("lists the spec's operations no request covers", () => {
    expect(securityHtmlReport(summary([item('get', [])], { inventory: { operations: 3, uncovered: ['DELETE /orders/{id}'] } }), 'Shop', at))
      .toContain("<p>The spec has 3 operations; 1 has no request, so the checks didn't reach it:</p>\n<ul>\n<li><code>DELETE /orders/{id}</code></li>");
    expect(securityHtmlReport(summary([item('get', [])], { inventory: { operations: 1, uncovered: [] } }), 'Shop', at)).toContain('The spec has 1 operation; each has a request.');
    expect(securityHtmlReport(run, 'Shop', at)).not.toContain('Against the spec');
  });

  it('against a baseline, says which findings are new, the new ones first, and what is gone', () => {
    const before = readBaseline(securityJsonReport(summary([item('list', [finding('no-credentials', 'high'), finding('hsts-missing', 'low')])]), 'Shop', at));
    const now = summary([item('list', [finding('no-credentials', 'high'), finding('token-unsigned', 'high')])]);
    const html = securityHtmlReport(now, 'Shop', at, compareWithBaseline(now, before));

    expect(html).toContain('Against the baseline: <strong>1 new</strong>, 1 known, 1 no longer found.');
    expect(html).toContain('<th>Baseline</th>');
    expect(html.indexOf('<td><strong>New</strong></td><td>Title of token-unsigned</td>')).toBeGreaterThan(0);
    expect(html.indexOf('<strong>New</strong>')).toBeLessThan(html.indexOf('<span class="faint">Known</span>'));
    expect(html).toContain('<h2>No longer found</h2>');
    expect(html).toContain('<li>Title of hsts-missing: Orders / list</li>');
    expect(html).toContain('Title of no-credentials <span class="faint">(known)</span>');
    expect(securityHtmlReport(run, 'Shop', at)).not.toContain('Baseline');
  });
});
