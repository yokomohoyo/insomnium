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
