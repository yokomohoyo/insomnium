import type { RunResult, RunSummary } from '../network/runner';

// The run's reports: a line per request as it finishes, a summary, and the
// JUnit XML and JSON files for CI.

export const resultName = ({ folders, name }: Pick<RunResult, 'folders' | 'name'>) => [...folders, name].join(' / ');

const elapsed = (ms?: number) => ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

export const formatResult = (result: RunResult) => {
  const status = result.error ? `Error: ${result.error}` : `${result.statusCode ?? ''} ${result.statusMessage ?? ''}`.trim();
  const lines = [`  ${result.passed ? '✓' : '✗'} ${resultName(result)}  ${result.method} ${status}  ${elapsed(result.elapsedTime)}`.trimEnd()];
  for (const assertion of result.assertions) {
    lines.push(`      ${assertion.passed ? '✓' : '✗'} ${assertion.message}`);
  }
  return lines.join('\n');
};

export const formatSummary = (summary: RunSummary) => {
  const { requests, assertions } = summary;
  return [
    `${requests.total} ${requests.total === 1 ? 'request' : 'requests'}, ${requests.failed} failed`,
    `${assertions.total} ${assertions.total === 1 ? 'assertion' : 'assertions'}, ${assertions.failed} failed`,
    elapsed(summary.elapsedTime),
  ].join(' · ') + (summary.bailed ? '\nStopped at the first failure (--bail)' : '');
};

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

export const jsonReport = (summary: RunSummary, name: string) => JSON.stringify({ name, ...summary }, null, 2) + '\n';
