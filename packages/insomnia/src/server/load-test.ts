import type { LoadSummary, LoadThresholds } from '../network/load-stats';
import { MAX_DURATION_MS, MAX_VIRTUAL_USERS } from '../network/load-test';
import { sendingEnvironment } from './run';
import { emptySources, requireSources, Sources, SOURCES_USAGE, takeSourceOption } from './sources';

// `insomnium-server load`: a load test for CI. Virtual users send the
// requests over and over for a while; it exits 1 when a threshold is broken.

export interface LoadConfig extends Sources {
  environment?: string;
  folder?: string;
  virtualUsers: number;
  durationMs: number;
  rampUpMs: number;
  thinkTimeMs: number;
  thresholds: LoadThresholds;
  json?: string;
  allowedHosts: string[];
  variables: Record<string, string>;
  validateSSL: boolean;
  allowedEnvironmentVariables: string;
  allowedSecrets: string;
}

export const LOAD_USAGE = `Usage: insomnium-server load --collection <file> [--users <n>] [--duration <time>] [options]

Load tests the collection's HTTP requests: each virtual user sends them in
order, again and again, until the time is up. Prints the latency percentiles,
throughput and errors, and exits 1 when a threshold is broken. A request fails
when it can't be sent, answers 400 or above (unless it has its own status
assertion), or fails an assertion.

${SOURCES_USAGE}
  --folder       only the requests in this folder: its name, or a path like "Users/Admin"
  --env          the sub environment to send with, by name
  --users        virtual users, 1 to ${MAX_VIRTUAL_USERS} (default 5)
  --duration     how long: 30s, 2m, 500ms (default 30s, at most ${MAX_DURATION_MS / 60_000}m)
  --ramp-up      start the users one after another over this long (default 0)
  --think-time   each user's wait after each request (default 0)
  --max-p95      fail when the 95th percentile latency is over this, in ms
  --max-p99      fail when the 99th percentile latency is over this, in ms
  --max-errors   fail when more than this percentage of requests fail, such as 1 or 0.5
  --json         write the results as JSON to this file

Environment: as for run (insomnium-server run --help). Load test only APIs
you're allowed to.`;

// 30s, 2m, 1.5s, 500ms, or a plain number of seconds
export function parseDuration(option: string, value: string) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value.trim());
  if (!match) {
    throw new Error(`${option} must be a time such as 30s, 2m or 500ms`);
  }
  const amount = Number(match[1]);
  return Math.round(match[2] === 'ms' ? amount : match[2] === 'm' ? amount * 60_000 : amount * 1000);
}

const number = (option: string, value: string, min: number, max = Infinity) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${option} must be a number from ${min}${max === Infinity ? '' : ` to ${max}`}`);
  }
  return parsed;
};

export const parseLoadConfig = (argv: string[], env: Record<string, string | undefined>): LoadConfig => {
  const config: LoadConfig = {
    ...emptySources(env),
    virtualUsers: 5,
    durationMs: 30_000,
    rampUpMs: 0,
    thinkTimeMs: 0,
    thresholds: {},
    ...sendingEnvironment(env),
  };

  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${option} needs a value`);
      }
      return next;
    };
    if (takeSourceOption(config, option, value)) {
      continue;
    }
    switch (option) {
      case '--env':
        config.environment = value();
        break;
      case '--folder':
        config.folder = value();
        break;
      case '--users': {
        const users = number(option, value(), 1, MAX_VIRTUAL_USERS);
        if (!Number.isInteger(users)) {
          throw new Error(`${option} must be a whole number`);
        }
        config.virtualUsers = users;
        break;
      }
      case '--duration':
        config.durationMs = parseDuration(option, value());
        if (config.durationMs < 1000 || config.durationMs > MAX_DURATION_MS) {
          throw new Error(`${option} must be from 1s to ${MAX_DURATION_MS / 60_000}m`);
        }
        break;
      case '--ramp-up':
        config.rampUpMs = parseDuration(option, value());
        break;
      case '--think-time':
        config.thinkTimeMs = parseDuration(option, value());
        break;
      case '--max-p95':
        config.thresholds.p95 = number(option, value(), 0);
        break;
      case '--max-p99':
        config.thresholds.p99 = number(option, value(), 0);
        break;
      case '--max-errors':
        config.thresholds.errorRate = number(option, value(), 0, 100) / 100;
        break;
      case '--json':
        config.json = value();
        break;
      default:
        throw new Error(`Unknown option ${option}`);
    }
  }

  requireSources(config);
  return config;
};

const pad = (text: string | number, width: number) => String(text).padStart(width);

// the results as a table, a row per request and one for all of them
export function formatLoadSummary(summary: LoadSummary) {
  const rows = [
    ...summary.byRequest.map(row => ({ ...row })),
    { ...summary.latency, name: 'All', count: summary.requests, failed: summary.failed },
  ];
  const nameWidth = Math.max(7, ...rows.map(row => row.name.length));
  const header = `${'Request'.padEnd(nameWidth)}  ${pad('Sent', 7)}  ${pad('Failed', 7)}  ${pad('Mean', 8)}  ${pad('p50', 8)}  ${pad('p90', 8)}  ${pad('p95', 8)}  ${pad('p99', 8)}  ${pad('Max', 8)}`;
  const lines = rows.map(row =>
    `${row.name.padEnd(nameWidth)}  ${pad(row.count, 7)}  ${pad(row.failed, 7)}  ${pad(`${row.mean} ms`, 8)}  ${pad(`${row.p50} ms`, 8)}  ${pad(`${row.p90} ms`, 8)}  ${pad(`${row.p95} ms`, 8)}  ${pad(`${row.p99} ms`, 8)}  ${pad(`${row.max} ms`, 8)}`);
  return [
    header,
    ...lines,
    '',
    `${summary.requests} requests in ${(summary.durationMs / 1000).toFixed(1)} s from ${summary.virtualUsers} ${summary.virtualUsers === 1 ? 'user' : 'users'} · ${summary.throughput}/s · ${summary.failed} failed (${(summary.errorRate * 100).toFixed(2)}%)${summary.stopped ? ' · stopped' : ''}`,
    `Status codes: ${Object.entries(summary.statusCodes).map(([code, count]) => `${code} × ${count}`).join(', ') || 'none'}`,
    ...summary.failures.map(failure => `  ✗ ${failure.count} × ${failure.reason}`),
  ].join('\n');
}
