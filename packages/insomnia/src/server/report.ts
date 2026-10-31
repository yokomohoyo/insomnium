import { describeSlower, type RunComparison } from '../network/run-compare';
import { resultName } from '../network/run-files';
import type { RunResult, RunSummary } from '../network/runner';

// The run's console output: a line per request as it finishes, and a summary

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

// the run against its baseline (--baseline): the requests that got slower,
// those that got faster, and what the baseline ran that this run didn't
export const formatComparison = (comparison: RunComparison, file: string) => {
  const faster = comparison.requests.filter(row => row.faster && row.before);
  return [
    `Against ${file}: ${comparison.slower ? `${comparison.slower} slower` : 'none slower'}${faster.length ? `, ${faster.length} faster` : ''}`,
    ...describeSlower(comparison).map(line => `  ✗ ${line}`),
    ...faster.map(row => `  ✓ ${row.name}: p95 ${row.before!.p95} ms → ${row.now.p95} ms (${Math.round((row.change ?? 0) * 100)}%)`),
    ...(comparison.missing.length ? [`  In the baseline, not run here: ${comparison.missing.join(', ')}`] : []),
  ].join('\n');
};
