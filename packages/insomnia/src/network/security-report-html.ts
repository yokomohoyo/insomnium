// A security run's report as one HTML page: to open in a browser, attach to a
// ticket or keep as a pipeline's artifact. It stands alone (its styles are in
// it, and it loads and runs nothing), and like the other reports it names
// where a credential was, never the credential.
import type { AuditSeverity } from '../common/response-audit';
import type { BaselineComparison } from './security-baseline';
import type { SecurityRunItem, SecurityRunSummary } from './security-run';

const SEVERITIES: AuditSeverity[] = ['high', 'medium', 'low', 'info'];
const LABELS: Record<AuditSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const OUTCOMES = { found: 'Found', passed: 'Passed', skipped: 'Not run', unclear: 'Unclear' };

// everything shown came from a collection or an API's answers: none of it is markup
const text = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const nameOf = ({ folders, name }: SecurityRunItem) => [...folders, name].join(' / ');
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1d1d24; --faint: #63636e; --line: #dcdce3; --panel: #f5f5f8; --high: #c0262d; --medium: #b45f06; --low: #2563a8; --info: #63636e; --ok: #1f7a3d; }
@media (prefers-color-scheme: dark) { :root { --bg: #17171c; --fg: #e8e8ee; --faint: #a0a0ac; --line: #34343e; --panel: #20202a; --high: #ff7b7b; --medium: #f0a95a; --low: #7ab3f0; --info: #a0a0ac; --ok: #6fcf8e; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 36px 0 12px; }
p { margin: 8px 0; }
.faint { color: var(--faint); }
.tiles { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0 8px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 16px; min-width: 96px; }
.tile b { display: block; font-size: 24px; line-height: 1.2; }
.high { color: var(--high); } .medium { color: var(--medium); } .low { color: var(--low); } .info { color: var(--info); } .ok { color: var(--ok); }
.scroll { overflow-x: auto; }
/* on a narrow screen a table scrolls sideways, rather than squeeze a column to a letter's width */
table { border-collapse: collapse; width: 100%; min-width: 720px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { font-size: 13px; color: var(--faint); font-weight: 600; white-space: nowrap; }
code { font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; overflow-wrap: anywhere; }
.badge { display: inline-block; font-size: 12px; font-weight: 600; border: 1px solid currentColor; border-radius: 10px; padding: 0 8px; white-space: nowrap; }
details { border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; }
summary { cursor: pointer; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
summary .url { color: var(--faint); font-size: 13px; overflow-wrap: anywhere; }
details > div { padding: 0 14px 12px; }
ul { margin: 8px 0; padding-left: 20px; }
li { margin: 4px 0; }
`;

export const securityHtmlReport = (summary: SecurityRunSummary, name: string, generated = new Date(), baseline?: BaselineComparison) => {
  const tested = summary.items.filter(({ outcome }) => outcome === 'tested').length;
  const audited = summary.items.filter(({ outcome }) => outcome === 'audited').length;
  const skipped = summary.items.length - tested - audited;
  const all = summary.items.flatMap(item => item.findings.map(finding => ({ item, finding })));
  const added = baseline ? SEVERITIES.reduce((sum, severity) => sum + baseline.fresh[severity], 0) : 0;

  const parts = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Security checks: ${text(name)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>Security checks: ${text(name)}</h1>`,
    `<p class="faint">${text(generated.toISOString())}. ${plural(summary.items.length, 'request')}: ${tested} tested, ${audited} checked from their last response, ${skipped} not checked. ${plural(summary.requests, 'request was', 'requests were')} sent${summary.stopped ? ', and the run was stopped before the end' : ''}.</p>`,
    '<div class="tiles">',
    ...SEVERITIES.map(severity => `<div class="tile"><b class="${summary.findings[severity] ? severity : 'faint'}">${summary.findings[severity]}</b>${LABELS[severity]}</div>`),
    '</div>',
  ];
  if (baseline) {
    parts.push(`<p>Against the baseline: <strong>${added} new</strong>, ${baseline.known} known, ${baseline.fixed.length} no longer found.</p>`);
  }
  parts.push('<p class="faint">By the <a href="https://owasp.org/API-Security/editions/2023/en/0x11-t10/">OWASP API Security Top 10</a>. A request with nothing found had none of these problems this once; that does not show the API is secure.</p>');

  parts.push('<h2>Findings</h2>');
  if (all.length) {
    parts.push('<div class="scroll"><table>', `<thead><tr><th>Severity</th>${baseline ? '<th>Baseline</th>' : ''}<th>Finding</th><th>Where</th><th>Request</th><th>Risk</th></tr></thead>`, '<tbody>');
    for (const severity of SEVERITIES) {
      const found = all.filter(({ finding }) => finding.severity === severity);
      // against a baseline, the new ones first
      for (const { item, finding } of baseline ? [...found.filter(({ finding }) => !finding.known), ...found.filter(({ finding }) => finding.known)] : found) {
        parts.push(`<tr><td><span class="badge ${severity}">${LABELS[severity]}</span></td>${baseline ? `<td>${finding.known ? '<span class="faint">Known</span>' : '<strong>New</strong>'}</td>` : ''}<td>${text(finding.title)}</td><td>${finding.evidence ? `<code>${text(finding.evidence)}</code>` : ''}</td><td>${text(nameOf(item))}<br><span class="faint">${text(item.method)} ${text(item.url)}</span></td><td>${text(finding.owasp)}</td></tr>`);
      }
    }
    parts.push('</tbody>', '</table></div>', '<h2>What each means</h2>', '<ul>');
    const seen = new Set<string>();
    for (const { finding } of all) {
      if (!seen.has(finding.id)) {
        seen.add(finding.id);
        parts.push(`<li><strong>${text(finding.title)}.</strong> ${text(finding.detail)}</li>`);
      }
    }
    parts.push('</ul>');
  } else {
    parts.push('<p class="ok">Nothing found.</p>');
  }

  if (baseline?.fixed.length) {
    parts.push('<h2>No longer found</h2>', '<p class="faint">The baseline had these, and this run looked for them and found none.</p>', '<ul>');
    baseline.fixed.forEach(({ title, evidence, request }) => parts.push(`<li>${text(title)}${evidence ? ` <code>${text(evidence)}</code>` : ''}: ${text(request)}</li>`));
    parts.push('</ul>');
  }

  if (summary.inventory) {
    const { operations, uncovered } = summary.inventory;
    parts.push('<h2>Against the spec</h2>', `<p>The spec has ${plural(operations, 'operation')}; ${uncovered.length ? `${uncovered.length} ${uncovered.length === 1 ? 'has' : 'have'} no request, so the checks didn't reach ${uncovered.length === 1 ? 'it' : 'them'}:` : 'each has a request.'}</p>`);
    if (uncovered.length) {
      parts.push('<ul>', ...uncovered.map(operation => `<li><code>${text(operation)}</code></li>`), '</ul>');
    }
  }

  parts.push('<h2>Requests</h2>');
  for (const item of summary.items) {
    const worst = SEVERITIES.find(severity => item.findings.some(finding => finding.severity === severity));
    const state = item.failed
      ? '<span class="badge high">Could not be tested</span>'
      : item.outcome === 'skipped'
        ? '<span class="badge info">Not checked</span>'
        : worst
          ? `<span class="badge ${worst}">${plural(item.findings.length, 'finding')}</span>`
          : '<span class="badge ok">Nothing found</span>';
    // the ones with something to read start open
    parts.push(`<details${item.findings.length || item.failed ? ' open' : ''}>`, `<summary><strong>${text(nameOf(item))}</strong>${item.restricted ? ' <span class="badge info">Some users only</span>' : ''} ${state} <span class="url">${text(item.method)} ${text(item.url)}</span></summary>`, '<div>');
    if (item.note) {
      parts.push(`<p class="faint">${text(item.note)}</p>`);
    }
    if (item.findings.length) {
      parts.push('<ul>', ...item.findings.map(finding => `<li><span class="badge ${finding.severity}">${LABELS[finding.severity]}</span> ${text(finding.title)}${finding.evidence ? ` <code>${text(finding.evidence)}</code>` : ''}${finding.known ? ' <span class="faint">(known)</span>' : ''}</li>`), '</ul>');
    }
    if (item.checks.length) {
      parts.push('<div class="scroll"><table>', '<thead><tr><th>Test</th><th>Outcome</th><th>What came back</th></tr></thead>', '<tbody>');
      item.checks.forEach(check => parts.push(`<tr><td>${text(check.title)}</td><td class="${check.outcome === 'found' ? 'medium' : check.outcome === 'passed' ? 'ok' : 'faint'}">${OUTCOMES[check.outcome]}</td><td>${text(check.note)}</td></tr>`));
      parts.push('</tbody>', '</table></div>');
    }
    parts.push('</div>', '</details>');
  }

  parts.push('</main>', '</body>', '</html>');
  return `${parts.join('\n')}\n`;
};
