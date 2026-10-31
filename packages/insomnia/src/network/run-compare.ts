import type { RequestRunStats } from './run-stats';

// A run against a baseline: an earlier run's JSON report (the runner's Save
// JSON, or `insomnium-server run --json`), request by request. A request is
// slower when its p95 grew past the allowed share and by more than a few
// milliseconds, so the noise of fast requests doesn't count.

export interface BaselineStats {
  requestId?: string;
  name: string;
  p50: number;
  p95: number;
  count?: number;
  failed?: number;
}

export interface Baseline {
  name?: string;
  byRequest: BaselineStats[];
}

export interface RequestComparison {
  requestId: string;
  name: string;
  // missing when the baseline didn't run this request
  before?: { p50: number; p95: number };
  now: { p50: number; p95: number };
  // the p95's change, as a share of the baseline's (0.25 is 25% slower)
  change?: number;
  slower: boolean;
  faster: boolean;
}

export interface RunComparison {
  requests: RequestComparison[];
  // the requests the baseline ran that this run didn't
  missing: string[];
  slower: number;
}

export interface CompareOptions {
  // the share of the baseline's p95 a request may grow by, 0 to 1 and over
  maxSlowdown?: number;
  // milliseconds a change has to exceed to count either way
  minChangeMs?: number;
}

export const DEFAULT_MAX_SLOWDOWN = 0.2;
export const DEFAULT_MIN_CHANGE_MS = 5;

// the baseline from a report's text; throws when it isn't one
export function parseBaseline(text: string): Baseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('the baseline is not JSON: use a run report saved as JSON');
  }
  const byRequest = (parsed as Baseline)?.byRequest;
  if (!Array.isArray(byRequest) || !byRequest.every(row => row && typeof row.name === 'string' && typeof row.p95 === 'number' && typeof row.p50 === 'number')) {
    throw new Error("the baseline has no request numbers (byRequest): save a run's JSON report from this version or later");
  }
  return { name: (parsed as Baseline).name, byRequest };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function compareRuns(now: RequestRunStats[], baseline: Baseline, { maxSlowdown = DEFAULT_MAX_SLOWDOWN, minChangeMs = DEFAULT_MIN_CHANGE_MS }: CompareOptions = {}): RunComparison {
  const byId = new Map(baseline.byRequest.filter(row => row.requestId).map(row => [row.requestId!, row]));
  const byName = new Map(baseline.byRequest.map(row => [row.name, row]));
  const matched = new Set<BaselineStats>();
  const requests = now.map(row => {
    const before = byId.get(row.requestId) || byName.get(row.name);
    if (!before) {
      return { requestId: row.requestId, name: row.name, now: { p50: row.p50, p95: row.p95 }, slower: false, faster: false };
    }
    matched.add(before);
    const delta = row.p95 - before.p95;
    const change = before.p95 > 0 ? round(delta / before.p95) : undefined;
    const counts = Math.abs(delta) > minChangeMs;
    return {
      requestId: row.requestId,
      name: row.name,
      before: { p50: before.p50, p95: before.p95 },
      now: { p50: row.p50, p95: row.p95 },
      ...(change !== undefined ? { change } : {}),
      slower: counts && delta > 0 && (change === undefined || change > maxSlowdown),
      faster: counts && delta < 0 && (change !== undefined && -change > maxSlowdown),
    };
  });
  return {
    requests,
    missing: baseline.byRequest.filter(row => !matched.has(row)).map(row => row.name),
    slower: requests.filter(row => row.slower).length,
  };
}

// a line for each slower request, as the CLI and the reports say it
export const describeSlower = (comparison: RunComparison) => comparison.requests
  .filter(row => row.slower && row.before)
  .map(row => `${row.name}: p95 ${row.before!.p95} ms → ${row.now.p95} ms${row.change !== undefined ? ` (+${Math.round(row.change * 100)}%)` : ''}`);
