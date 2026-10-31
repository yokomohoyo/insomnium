import Papa from 'papaparse';

import { PHASE_LABELS, type PhaseDurations, phaseDurations } from '../common/timings';
import type { RunResult, RunSummary } from './runner';
import { requestRunStats } from './run-stats';

// What a run reads and writes, in the app and the CLI alike: data files, the
// JUnit XML and JSON reports for CI, and CSV and HTML reports for people.

export const resultName = ({ folders, name }: Pick<RunResult, 'folders' | 'name'>) => [...folders, name].join(' / ');

const xml = (text: unknown) => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // characters XML 1.0 can't hold at all
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const seconds = (ms?: number) => ((ms || 0) / 1000).toFixed(3);

// A test suite per request sent, a test case per assertion, plus one for
// the send itself when it failed or has no assertions to stand for it
export const junitReport = (summary: RunSummary, name: string) => {
  const suites = summary.results.map(result => {
    const suiteName = resultName(result) + (summary.iterations > 1 ? ` (iteration ${result.iteration})` : '');
    const cases = result.assertions.map(assertion => ({ name: assertion.message, failure: assertion.passed ? undefined : assertion.message }));
    if (result.error || !cases.length) {
      cases.unshift({ name: `${result.method} ${result.url || ''}`.trim(), failure: result.error });
    }
    const failures = cases.filter(testCase => testCase.failure !== undefined).length;
    const body = cases.map(testCase => {
      const attributes = `classname="${xml(suiteName)}" name="${xml(testCase.name)}" time="${seconds(result.elapsedTime)}"`;
      return testCase.failure === undefined
        ? `    <testcase ${attributes}/>`
        : `    <testcase ${attributes}>\n      <failure message="${xml(testCase.failure)}"/>\n    </testcase>`;
    });
    return { failures, tests: cases.length, text: `  <testsuite name="${xml(suiteName)}" tests="${cases.length}" failures="${failures}" time="${seconds(result.elapsedTime)}">\n${body.join('\n')}\n  </testsuite>` };
  });
  const tests = suites.reduce((sum, suite) => sum + suite.tests, 0);
  const failures = suites.reduce((sum, suite) => sum + suite.failures, 0);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(name)}" tests="${tests}" failures="${failures}" time="${seconds(summary.elapsedTime)}">`,
    ...suites.map(suite => suite.text),
    '</testsuites>',
    '',
  ].join('\n');
};

// Each result with its phases worked out, and each request's numbers over the run
export const jsonReport = (summary: RunSummary, name: string) => JSON.stringify({
  name,
  ...summary,
  results: summary.results.map(result => ({
    ...result,
    ...(result.timings && result.elapsedTime !== undefined ? { phases: phaseDurations(result.timings, result.elapsedTime) } : {}),
  })),
  byRequest: requestRunStats(summary.results, resultName),
}, null, 2) + '\n';

// A row per send, for a spreadsheet: times in milliseconds, sizes in bytes
export const csvReport = (summary: RunSummary) => Papa.unparse(summary.results.map(result => {
  const phases = result.timings && result.elapsedTime !== undefined ? phaseDurations(result.timings, result.elapsedTime) : undefined;
  return {
    iteration: result.iteration,
    request: resultName(result),
    method: result.method,
    url: result.url ?? '',
    status: result.statusCode ?? '',
    passed: result.passed,
    time: result.elapsedTime ?? '',
    dns: phases?.dns ?? '',
    connect: phases?.connect ?? '',
    tls: phases?.tls ?? '',
    wait: phases?.wait ?? '',
    download: phases?.download ?? '',
    bytes: result.bytes ?? '',
    httpVersion: result.httpVersion ?? '',
    error: result.error ?? '',
    failedAssertions: result.assertions.filter(assertion => !assertion.passed).map(assertion => assertion.message).join('; '),
  };
}), { escapeFormulae: true }) + '\n';

const ms = (value?: number) => value === undefined ? '' : value < 1000 ? `${value.toFixed(1)} ms` : `${(value / 1000).toFixed(2)} s`;
const size = (bytes?: number) => bytes === undefined ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const PHASE_COLORS: Record<keyof PhaseDurations, string> = {
  dns: '#7aa2f7',
  connect: '#9ece6a',
  tls: '#e0af68',
  wait: '#bb9af7',
  download: '#2ac3de',
};

// where a request's time goes, as a bar of its phases
const phaseBar = (phases?: PhaseDurations) => {
  if (!phases) {
    return '';
  }
  const total = Object.values(phases).reduce((sum, value) => sum + value, 0);
  if (!total) {
    return '';
  }
  const parts = (Object.keys(PHASE_LABELS) as (keyof PhaseDurations)[])
    .filter(phase => phases[phase] > 0)
    .map(phase => `<span style="width:${(phases[phase] / total * 100).toFixed(2)}%;background:${PHASE_COLORS[phase]}" title="${xml(PHASE_LABELS[phase])}: ${ms(phases[phase])}"></span>`);
  const title = (Object.keys(PHASE_LABELS) as (keyof PhaseDurations)[])
    .filter(phase => phase !== 'tls' || phases.tls > 0)
    .map(phase => `${PHASE_LABELS[phase]} ${ms(phases[phase])}`)
    .join(', ');
  return `<div class="bar" role="img" aria-label="${xml(title)}">${parts.join('')}</div>`;
};

// A page to read or attach to a ticket: one file, no scripts, nothing fetched
export const htmlReport = (summary: RunSummary, name: string, generated = new Date()) => {
  const stats = requestRunStats(summary.results, resultName);
  const passed = summary.results.filter(result => result.passed).length;
  const failures = summary.results.filter(result => !result.passed);
  const cold = stats.some(row => row.first !== undefined);
  const rows = stats.map(row => `<tr>
<td><span class="method">${xml(row.method)}</span> ${xml(row.name)}</td>
<td class="n">${row.count}</td><td class="n${row.failed ? ' bad' : ''}">${row.failed}</td>
<td class="n">${ms(row.min)}</td><td class="n">${ms(row.p50)}</td><td class="n">${ms(row.p95)}</td><td class="n">${ms(row.max)}</td><td class="n">${ms(row.sd)}</td>
${cold ? `<td class="n">${row.first === undefined ? '' : `${ms(row.first)} / ${ms(row.warmP50)}`}</td>` : ''}
<td class="n">${size(row.bytes)}</td>
<td class="phases">${phaseBar(row.phases)}</td>
</tr>`).join('\n');
  const legend = (Object.keys(PHASE_LABELS) as (keyof PhaseDurations)[])
    .map(phase => `<span><i style="background:${PHASE_COLORS[phase]}"></i>${xml(PHASE_LABELS[phase])}</span>`).join('');
  const failureItems = failures.map(result => {
    const reasons = result.error ? [result.error] : result.assertions.filter(assertion => !assertion.passed).map(assertion => assertion.message);
    return `<li><strong>${xml(resultName(result))}</strong>${summary.iterations > 1 ? ` (iteration ${result.iteration})` : ''}: ${reasons.map(xml).join('; ')}</li>`;
  }).join('\n');
  const each = summary.results.map(result => `<tr>
<td class="n">${result.iteration}</td><td><span class="method">${xml(result.method)}</span> ${xml(resultName(result))}</td>
<td class="n">${result.error ? 'Error' : xml(result.statusCode ?? '')}</td><td class="n">${ms(result.elapsedTime)}</td><td class="n">${size(result.bytes)}</td>
<td class="${result.passed ? 'good' : 'bad'}">${result.passed ? 'Passed' : 'Failed'}</td>
</tr>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${xml(name)}: run report</title>
<style>
:root { color-scheme: light dark; --bg: #fff; --fg: #1f2328; --faint: #656d76; --line: #d0d7de; --good: #1a7f37; --bad: #cf222e; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --faint: #8d96a0; --line: #30363d; --good: #3fb950; --bad: #f85149; } }
body { margin: 0 auto; max-width: 1100px; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; }
.faint { color: var(--faint); } .good { color: var(--good); } .bad { color: var(--bad); }
.cards { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.card { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; min-width: 120px; }
.card b { display: block; font-size: 18px; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: middle; white-space: nowrap; }
th { font-weight: 600; color: var(--faint); font-size: 12px; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
.method { font: 11px ui-monospace, monospace; color: var(--faint); }
.phases { min-width: 160px; width: 25%; }
.bar { display: flex; height: 10px; border-radius: 3px; overflow: hidden; background: var(--line); }
.bar span { display: block; height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--faint); margin-top: 8px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
</style>
</head>
<body>
<h1>${xml(name)}</h1>
<div class="faint">Run report from Insomnium · ${xml(generated.toISOString().replace('T', ' ').slice(0, 19))} UTC</div>
<div class="cards">
<div class="card"><b class="${summary.requests.failed ? 'bad' : 'good'}">${passed} of ${summary.requests.total}</b>requests passed</div>
<div class="card"><b>${summary.assertions.total - summary.assertions.failed} of ${summary.assertions.total}</b>assertions passed</div>
<div class="card"><b>${summary.iterations}</b>${summary.iterations === 1 ? 'iteration' : 'iterations'}</div>
<div class="card"><b>${ms(summary.elapsedTime)}</b>in all</div>
</div>
${summary.bailed ? '<p class="bad">Stopped at the first request that failed.</p>' : ''}${summary.stopped ? '<p class="bad">Stopped before it finished.</p>' : ''}
<h2>By request</h2>
<div class="scroll"><table>
<thead><tr><th>Request</th><th class="n">Sent</th><th class="n">Failed</th><th class="n">Min</th><th class="n">p50</th><th class="n">p95</th><th class="n">Max</th><th class="n">Std dev</th>${cold ? '<th class="n">First / later p50</th>' : ''}<th class="n">Size</th><th>Where the time goes</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
<div class="legend">${legend}</div>
${failures.length ? `<h2>Failures</h2>\n<ul>\n${failureItems}\n</ul>` : ''}
<h2>Every request</h2>
<div class="scroll"><table>
<thead><tr><th class="n">#</th><th>Request</th><th class="n">Status</th><th class="n">Time</th><th class="n">Size</th><th>Result</th></tr></thead>
<tbody>
${each}
</tbody>
</table></div>
</body>
</html>
`;
};

// A CSV file with a header row, or a JSON array of objects
export const parseDataFile = (file: string, text: string): Record<string, unknown>[] => {
  if (/\.json$/i.test(file)) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (!rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
      throw new Error(`${file} must hold an object, or an array of objects`);
    }
    return rows;
  }
  const { data, errors } = Papa.parse<Record<string, string>>(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, { header: true, skipEmptyLines: true });
  // a file with one column has no delimiter to find, and the default is right
  const problems = errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (problems.length) {
    const [error] = problems;
    throw new Error(`${file}: ${error.message}${error.row === undefined ? '' : ` (row ${error.row + 1})`}`);
  }
  return data;
};
