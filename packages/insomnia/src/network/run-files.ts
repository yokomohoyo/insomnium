import Papa from 'papaparse';

import { phaseDurations } from '../common/timings';
import { card, generatedAt, ms, phaseBar, phaseLegend, reportPage, size, xml } from './report-html';
import type { RunResult, RunSummary } from './runner';
import type { RequestComparison, RunComparison } from './run-compare';
import { requestRunStats } from './run-stats';

// What a run reads and writes, in the app and the CLI alike: data files, the
// JUnit XML and JSON reports for CI, and CSV and HTML reports for people.

export const resultName = ({ folders, name }: Pick<RunResult, 'folders' | 'name'>) => [...folders, name].join(' / ');

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
// with a baseline's comparison when the run was held to one
export const jsonReport = (summary: RunSummary, name: string, comparison?: RunComparison) => JSON.stringify({
  name,
  ...summary,
  results: summary.results.map(result => ({
    ...result,
    ...(result.timings && result.elapsedTime !== undefined ? { phases: phaseDurations(result.timings, result.elapsedTime) } : {}),
  })),
  byRequest: requestRunStats(summary.results, resultName),
  ...(comparison ? { comparison } : {}),
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
}), { escapeFormulae: true, newline: '\n' }) + '\n';

// a request's p95 against the baseline's: the change, and the two times
const versus = (row?: RequestComparison) => {
  if (!row?.before) {
    return '<td class="n faint">new</td>';
  }
  const percent = row.change === undefined ? '' : `${row.change > 0 ? '+' : ''}${Math.round(row.change * 100)}% `;
  return `<td class="n${row.slower ? ' bad' : row.faster ? ' good' : ''}">${percent}<span class="faint">(${ms(row.before.p95)} → ${ms(row.now.p95)})</span></td>`;
};

// A page to read or attach to a ticket: one file, no scripts, nothing fetched;
// with a baseline's comparison when the run was held to one
export const htmlReport = (summary: RunSummary, name: string, generated = new Date(), comparison?: RunComparison) => {
  const stats = requestRunStats(summary.results, resultName);
  const compared = new Map(comparison?.requests.map(row => [row.requestId, row]));
  const passed = summary.results.filter(result => result.passed).length;
  const failures = summary.results.filter(result => !result.passed);
  const cold = stats.some(row => row.first !== undefined);
  const rows = stats.map(row => `<tr>
<td><span class="method">${xml(row.method)}</span> ${xml(row.name)}</td>
<td class="n">${row.count}</td><td class="n${row.failed ? ' bad' : ''}">${row.failed}</td>
<td class="n">${ms(row.min)}</td><td class="n">${ms(row.p50)}</td><td class="n">${ms(row.p95)}</td><td class="n">${ms(row.max)}</td><td class="n">${ms(row.sd)}</td>
${cold ? `<td class="n">${row.first === undefined ? '' : `${ms(row.first)} / ${ms(row.warmP50)}`}</td>` : ''}
<td class="n">${size(row.bytes)}</td>
${comparison ? versus(compared.get(row.requestId)) : ''}
<td class="phases">${phaseBar(row.phases)}</td>
</tr>`).join('\n');
  const failureItems = failures.map(result => {
    const reasons = result.error ? [result.error] : result.assertions.filter(assertion => !assertion.passed).map(assertion => assertion.message);
    return `<li><strong>${xml(resultName(result))}</strong>${summary.iterations > 1 ? ` (iteration ${result.iteration})` : ''}: ${reasons.map(xml).join('; ')}</li>`;
  }).join('\n');
  const each = summary.results.map(result => `<tr>
<td class="n">${result.iteration}</td><td><span class="method">${xml(result.method)}</span> ${xml(resultName(result))}</td>
<td class="n">${result.error ? 'Error' : xml(result.statusCode ?? '')}</td><td class="n">${ms(result.elapsedTime)}</td><td class="n">${size(result.bytes)}</td>
<td class="${result.passed ? 'good' : 'bad'}">${result.passed ? 'Passed' : 'Failed'}</td>
</tr>`).join('\n');
  return reportPage({
    title: `${name}: run report`,
    heading: name,
    subtitle: `Run report from Insomnium · ${generatedAt(generated)}`,
    body: `<div class="cards">
${card(`${passed} of ${summary.requests.total}`, 'requests passed', summary.requests.failed ? 'bad' : 'good')}
${card(`${summary.assertions.total - summary.assertions.failed} of ${summary.assertions.total}`, 'assertions passed')}
${card(String(summary.iterations), summary.iterations === 1 ? 'iteration' : 'iterations')}
${card(ms(summary.elapsedTime), 'in all')}
${comparison ? card(String(comparison.slower), comparison.slower === 1 ? 'request slower than the baseline' : 'requests slower than the baseline', comparison.slower ? 'bad' : 'good') : ''}
</div>
${summary.bailed ? '<p class="bad">Stopped at the first request that failed.</p>' : ''}${summary.stopped ? '<p class="bad">Stopped before it finished.</p>' : ''}
<h2>By request</h2>
<div class="scroll"><table>
<thead><tr><th>Request</th><th class="n">Sent</th><th class="n">Failed</th><th class="n">Min</th><th class="n">p50</th><th class="n">p95</th><th class="n">Max</th><th class="n">Std dev</th>${cold ? '<th class="n">First / later p50</th>' : ''}<th class="n">Size</th>${comparison ? '<th class="n">p95 vs baseline</th>' : ''}<th>Where the time goes</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
${phaseLegend()}
${comparison?.missing.length ? `<p class="faint">In the baseline, not run here: ${comparison.missing.map(xml).join(', ')}.</p>` : ''}
${failures.length ? `<h2>Failures</h2>\n<ul>\n${failureItems}\n</ul>` : ''}
<h2>Every request</h2>
<div class="scroll"><table>
<thead><tr><th class="n">#</th><th>Request</th><th class="n">Status</th><th class="n">Time</th><th class="n">Size</th><th>Result</th></tr></thead>
<tbody>
${each}
</tbody>
</table></div>`,
  });
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
