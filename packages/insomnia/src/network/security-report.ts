// A security run's report (security-run.ts), to keep or to hand to a tool:
// Markdown to read, JSON as it is, SARIF for what takes code scanning results.
// A finding names where a credential was, never the credential, and a URL is
// shown without its query's values, so a report is safe to pass on.
import type { AuditFinding, AuditSeverity } from '../common/response-audit';
import { securityRuleName } from '../common/security-rules';
import { type BaselineComparison, requestKey } from './security-baseline';
import type { SecurityRunItem, SecurityRunSummary } from './security-run';

const SEVERITIES: AuditSeverity[] = ['high', 'medium', 'low', 'info'];
const LABELS: Record<AuditSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };

// "Orders / List (GET https://shop.example.com/orders)"
const titleOf = ({ folders, name, method, url }: SecurityRunItem) => `${[...folders, name].join(' / ')} (${method} ${url})`;

const counts = ({ findings }: SecurityRunSummary) => SEVERITIES.filter(severity => findings[severity]).map(severity => `${findings[severity]} ${LABELS[severity].toLowerCase()}`).join(', ') || 'none';

// one line of a Markdown table or list: no pipes or line breaks to break it
// (backslashes first, or one before a pipe would undo its escape)
const cell = (text: string) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

// (a finding an earlier run had too says so itself: `known`)
export const securityJsonReport = (summary: SecurityRunSummary, name: string, generated = new Date(), baseline?: BaselineComparison) => JSON.stringify({
  name,
  generated: generated.toISOString(),
  findings: summary.findings,
  requests: summary.requests,
  stopped: summary.stopped,
  ...(summary.inventory ? { inventory: summary.inventory } : {}),
  ...(baseline ? { baseline: { new: baseline.fresh, known: baseline.known, fixed: baseline.fixed } } : {}),
  items: summary.items,
}, null, 2);

export const securityMarkdownReport = (summary: SecurityRunSummary, name: string, generated = new Date(), baseline?: BaselineComparison) => {
  const tested = summary.items.filter(({ outcome }) => outcome === 'tested').length;
  const audited = summary.items.filter(({ outcome }) => outcome === 'audited').length;
  const skipped = summary.items.filter(({ outcome }) => outcome === 'skipped');
  const lines = [
    `# Security checks: ${cell(name)}`,
    '',
    `${generated.toISOString()}. ${summary.items.length} requests: ${tested} tested, ${audited} checked from their last response, ${skipped.length} not checked. ${summary.requests} requests were sent${summary.stopped ? ', and the run was stopped before the end' : ''}.`,
    '',
    `Findings: ${counts(summary)}.`,
    '',
    'By the [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/). A request with nothing found had none of these problems this once; that does not show the API is secure.',
  ];

  if (baseline) {
    const added = SEVERITIES.reduce((sum, severity) => sum + baseline.fresh[severity], 0);
    lines.push('', `Against the baseline: ${added} new, ${baseline.known} known, ${baseline.fixed.length} no longer found.`);
  }

  const all = summary.items.flatMap(item => item.findings.map(finding => ({ item, finding })));
  if (all.length) {
    // against a baseline, the new ones first within each severity
    lines.push('', '## Findings', '', `| Severity | ${baseline ? 'Baseline | ' : ''}Finding | Where | Request | Risk |`, `| --- | ${baseline ? '--- | ' : ''}--- | --- | --- | --- |`);
    for (const severity of SEVERITIES) {
      const found = all.filter(({ finding }) => finding.severity === severity);
      for (const { item, finding } of baseline ? [...found.filter(({ finding }) => !finding.known), ...found.filter(({ finding }) => finding.known)] : found) {
        lines.push(`| ${LABELS[severity]} | ${baseline ? `${finding.known ? 'Known' : '**New**'} | ` : ''}${cell(finding.title)} | ${finding.evidence ? `\`${cell(finding.evidence)}\`` : ''} | ${cell(titleOf(item))} | ${cell(finding.owasp)} |`);
      }
    }
    lines.push('', '## What each means', '');
    const seen = new Set<string>();
    for (const { finding } of all) {
      if (!seen.has(finding.id)) {
        seen.add(finding.id);
        lines.push(`- **${cell(finding.title)}.** ${cell(finding.detail)}`);
      }
    }
  }

  if (baseline?.fixed.length) {
    lines.push('', '## No longer found', '', 'The baseline had these, and this run looked for them and found none:', '', ...baseline.fixed.map(({ title, evidence, request }) => `- ${cell(title)}${evidence ? ` (\`${cell(evidence)}\`)` : ''}: ${cell(request)}`));
  }

  if (summary.inventory) {
    const { operations, uncovered } = summary.inventory;
    lines.push('', '## Against the spec', '', `The spec has ${operations} ${operations === 1 ? 'operation' : 'operations'}; ${uncovered.length ? `${uncovered.length} ${uncovered.length === 1 ? 'has' : 'have'} no request, so the checks didn't reach ${uncovered.length === 1 ? 'it' : 'them'}:` : 'each has a request.'}`);
    if (uncovered.length) {
      lines.push('', ...uncovered.map(operation => `- \`${cell(operation)}\``));
    }
  }

  lines.push('', '## Requests', '');
  for (const item of summary.items) {
    lines.push(`### ${cell(titleOf(item))}`, '');
    if (item.note) {
      lines.push(cell(item.note), '');
    }
    if (item.checks.length) {
      lines.push('| Test | Outcome | What came back |', '| --- | --- | --- |');
      item.checks.forEach(check => lines.push(`| ${cell(check.title)} | ${check.outcome === 'skipped' ? 'not run' : check.outcome} | ${cell(check.note)} |`));
      lines.push('');
    }
    if (item.outcome !== 'skipped') {
      lines.push(item.findings.length ? `Found: ${item.findings.map(({ title }) => cell(title)).join('; ')}.` : 'Nothing found.', '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

// SARIF's levels for ours
const LEVELS: Record<AuditSeverity, 'error' | 'warning' | 'note'> = { high: 'error', medium: 'warning', low: 'note', info: 'note' };
// and the number GitHub's code scanning sorts by
const SCORES: Record<AuditSeverity, string> = { high: '8.0', medium: '5.0', low: '3.0', info: '1.0' };

export const securitySarifReport = (summary: SecurityRunSummary, name: string, version: string, baseline?: BaselineComparison) => {
  const rules = new Map<string, AuditFinding>();
  summary.items.forEach(item => item.findings.forEach(finding => rules.has(finding.id) || rules.set(finding.id, finding)));
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Insomnium',
          version,
          informationUri: 'https://github.com/yokomohoyo/insomnium',
          rules: [...rules.values()].map(finding => ({
            id: finding.id,
            name: securityRuleName(finding.id),
            shortDescription: { text: securityRuleName(finding.id) },
            fullDescription: { text: finding.detail },
            helpUri: 'https://owasp.org/API-Security/editions/2023/en/0x11-t10/',
            defaultConfiguration: { level: LEVELS[finding.severity] },
            properties: { tags: ['security', finding.owasp], 'security-severity': SCORES[finding.severity] },
          })),
        },
      },
      automationDetails: { id: `insomnium-security/${name}` },
      results: summary.items.flatMap(item => item.findings.map(finding => ({
        ruleId: finding.id,
        level: LEVELS[finding.severity],
        // against a baseline: whether an earlier run had it
        ...(baseline ? { baselineState: finding.known ? 'unchanged' : 'new' } : {}),
        message: { text: `${finding.title}${finding.evidence ? ` (${finding.evidence})` : ''}: ${titleOf(item)}. ${finding.detail}` },
        // an API has no file to point at: the request is where it was found
        locations: [{
          logicalLocations: [{ name: `${item.method} ${item.url}`, fullyQualifiedName: [...item.folders, item.name].join('/'), kind: 'resource' }],
        }],
        // (by the request's place in the collection: its id doesn't outlive a run in a pipeline)
        partialFingerprints: { 'insomnium/v2': `${finding.id}:${requestKey(item)}:${finding.evidence || ''}` },
        properties: { owasp: finding.owasp, severity: finding.severity, requestId: item.requestId },
      }))),
    }],
  }, null, 2);
};
