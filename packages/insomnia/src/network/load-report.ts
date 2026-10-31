import Papa from 'papaparse';

import { checkThresholds, type LoadSummary, type LoadThresholds } from './load-stats';
import { card, generatedAt, ms, phaseBar, phaseLegend, reportPage, size, timelineSvg, xml } from './report-html';

// What a load test saves, in the app and `insomnium-server load` alike: a page
// to read or share, its seconds as CSV, and the JSON that CI reads.

// `broken` as `insomnium-server load --json` always wrote it; `checks` holds the kept ones too
export const loadJsonReport = (summary: LoadSummary, name: string, thresholds: LoadThresholds = {}) => {
  const checks = checkThresholds(summary, thresholds);
  return JSON.stringify({ name, ...summary, thresholds, broken: checks.filter(check => !check.passed).map(check => check.message), checks }, null, 2) + '\n';
};

// A row a second: users, requests, failures and latency
export const loadCsvReport = (summary: LoadSummary) => Papa.unparse(summary.timeline.map(point => ({
  second: point.second,
  users: point.users,
  requests: point.requests,
  failed: point.failed,
  p50: point.p50,
  p95: point.p95,
})), { newline: '\n' }) + '\n';

export const loadHtmlReport = (summary: LoadSummary, name: string, thresholds: LoadThresholds = {}, generated = new Date()) => {
  const checks = checkThresholds(summary, thresholds);
  const rows = [
    ...summary.byRequest.map(row => ({ ...row, all: false })),
    { ...summary.latency, requestId: 'all', name: 'All', count: summary.requests, failed: summary.failed, phases: undefined, bytes: undefined, all: true },
  ].map(row => `<tr>
<td>${row.all ? '<strong>All</strong>' : xml(row.name)}</td>
<td class="n">${row.count}</td><td class="n${row.failed ? ' bad' : ''}">${row.failed}</td>
<td class="n">${ms(row.mean)}</td><td class="n">${ms(row.p50)}</td><td class="n">${ms(row.p90)}</td><td class="n">${ms(row.p95)}</td><td class="n">${ms(row.p99)}</td><td class="n">${ms(row.max)}</td>
<td class="n">${size(row.bytes)}</td>
<td class="phases">${phaseBar(row.phases)}</td>
</tr>`).join('\n');
  const settings = `${summary.virtualUsers} ${summary.virtualUsers === 1 ? 'user' : 'users'} for ${(summary.durationMs / 1000).toFixed(1)} s`;
  return reportPage({
    title: `${name}: load test`,
    heading: name,
    subtitle: `Load test from Insomnium · ${settings} · ${generatedAt(generated)}`,
    body: `<div class="cards">
${card(String(summary.requests), 'requests')}
${card(`${summary.throughput}/s`, 'throughput')}
${card(`${(summary.errorRate * 100).toFixed(2)}%`, `failed (${summary.failed})`, summary.failed ? 'bad' : 'good')}
${card(ms(summary.latency.p50), 'p50')}
${card(ms(summary.latency.p95), 'p95')}
${card(ms(summary.latency.p99), 'p99')}
</div>
${summary.stopped ? '<p class="bad">Stopped before its time was up.</p>' : ''}
${checks.length ? `<h2>Thresholds</h2>\n<ul class="checks">\n${checks.map(check => `<li class="${check.passed ? 'good' : 'bad'}">${xml(check.message)}</li>`).join('\n')}\n</ul>` : ''}
<h2>Over time</h2>
${timelineSvg(summary.timeline)}
<h2>By request</h2>
<div class="scroll"><table>
<thead><tr><th>Request</th><th class="n">Sent</th><th class="n">Failed</th><th class="n">Mean</th><th class="n">p50</th><th class="n">p90</th><th class="n">p95</th><th class="n">p99</th><th class="n">Max</th><th class="n">Size</th><th>Where the time goes</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
${phaseLegend()}
<h2>Status codes</h2>
<p>${Object.entries(summary.statusCodes).map(([code, count]) => `${xml(code)} × ${count}`).join(', ') || 'None'}</p>
${summary.failures.length ? `<h2>Failures</h2>\n<ul>\n${summary.failures.map(failure => `<li>${failure.count} × ${xml(failure.reason)}</li>`).join('\n')}\n</ul>` : ''}`,
  });
};
