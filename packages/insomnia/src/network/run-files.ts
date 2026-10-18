import Papa from 'papaparse';

import type { RunResult, RunSummary } from './runner';

// What a run reads and writes, in the app and the CLI alike: data files, and
// the JUnit XML and JSON reports for CI.

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

export const jsonReport = (summary: RunSummary, name: string) => JSON.stringify({ name, ...summary }, null, 2) + '\n';

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
