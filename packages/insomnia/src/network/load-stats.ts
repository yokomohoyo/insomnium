import { type PhaseDurations, phaseDurations } from '../common/timings';
import type { ResponseTimings } from '../models/response';

// A load test's numbers (network/load-test.ts): latency percentiles,
// throughput and errors, overall, for each request, and second by second.

export interface LoadSample {
  requestId: string;
  name: string;
  // milliseconds: libcurl's total time, or until the send failed
  elapsed: number;
  // sent, below 400 (or as its own status assertion wants), and every assertion passed
  ok: boolean;
  statusCode?: number;
  error?: string;
  // when each part of the exchange was done, and the body's size received
  timings?: ResponseTimings;
  bytes?: number;
}

// One second of a test: what was sent, and how fast it came back
export interface TimelinePoint {
  // from the start: 0 is the first second
  second: number;
  // the users sending during it, at most
  users: number;
  requests: number;
  failed: number;
  p50: number;
  p95: number;
}

// the latencies kept for each second's percentiles; a busier second counts on with these
const LATENCIES_PER_SECOND = 500;

// Counts every send into its second as the test runs, so the timeline holds
// them all, however many samples the percentiles keep
export class TimelineRecorder {
  private seconds: { users: number; requests: number; failed: number; latencies: number[] }[] = [];

  record(atMs: number, sample: Pick<LoadSample, 'elapsed' | 'ok'>, users: number) {
    const index = Math.max(0, Math.floor(atMs / 1000));
    for (let missing = this.seconds.length; missing <= index; missing++) {
      this.seconds.push({ users: 0, requests: 0, failed: 0, latencies: [] });
    }
    const second = this.seconds[index];
    second.requests++;
    second.failed += sample.ok ? 0 : 1;
    second.users = Math.max(second.users, users);
    if (second.latencies.length < LATENCIES_PER_SECOND) {
      second.latencies.push(sample.elapsed);
    } else {
      const slot = Math.floor(Math.random() * second.requests);
      if (slot < LATENCIES_PER_SECOND) {
        second.latencies[slot] = sample.elapsed;
      }
    }
  }

  points(): TimelinePoint[] {
    return this.seconds.map((second, index) => {
      const sorted = [...second.latencies].sort((a, b) => a - b);
      return { second: index, users: second.users, requests: second.requests, failed: second.failed, p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)) };
    });
  }
}

export interface LatencyStats {
  count: number;
  failed: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LoadSummary {
  virtualUsers: number;
  // how long it ran
  durationMs: number;
  requests: number;
  failed: number;
  // failed / requests, 0 to 1
  errorRate: number;
  // requests a second
  throughput: number;
  latency: LatencyStats;
  // with the mean of each phase and the mean size, from the sends that have them
  byRequest: (LatencyStats & { requestId: string; name: string; phases?: PhaseDurations; bytes?: number })[];
  // second by second
  timeline: TimelinePoint[];
  statusCodes: Record<string, number>;
  // the most common reasons sends failed, with how often
  failures: { reason: string; count: number }[];
  // stopped before its time was up
  stopped: boolean;
}

// the nearest-rank percentile of sorted values
export const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : 0;

const round = (ms: number) => Math.round(ms * 10) / 10;

export function latencyStats(samples: LoadSample[]): LatencyStats {
  const sorted = samples.map(sample => sample.elapsed).sort((a, b) => a - b);
  return {
    count: samples.length,
    failed: samples.filter(sample => !sample.ok).length,
    min: round(sorted[0] ?? 0),
    mean: round(sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
}

const failureReason = (sample: LoadSample) =>
  sample.error ? sample.error.split('\n')[0].slice(0, 200) : sample.statusCode !== undefined && sample.statusCode >= 400 ? `HTTP ${sample.statusCode}` : 'An assertion failed';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

// the mean of each phase over the sends libcurl timed
export function meanPhases(samples: LoadSample[]): PhaseDurations | undefined {
  const phases = samples.filter(sample => sample.timings).map(sample => phaseDurations(sample.timings!, sample.elapsed));
  if (!phases.length) {
    return undefined;
  }
  return {
    dns: round(mean(phases.map(phase => phase.dns))),
    connect: round(mean(phases.map(phase => phase.connect))),
    tls: round(mean(phases.map(phase => phase.tls))),
    wait: round(mean(phases.map(phase => phase.wait))),
    download: round(mean(phases.map(phase => phase.download))),
  };
}

export function summarizeLoad(samples: LoadSample[], { virtualUsers, durationMs, stopped, timeline = [] }: { virtualUsers: number; durationMs: number; stopped: boolean; timeline?: TimelinePoint[] }): LoadSummary {
  const byRequest = new Map<string, LoadSample[]>();
  const statusCodes: Record<string, number> = {};
  const failures = new Map<string, number>();
  for (const sample of samples) {
    const group = byRequest.get(sample.requestId);
    if (group) {
      group.push(sample);
    } else {
      byRequest.set(sample.requestId, [sample]);
    }
    const code = sample.statusCode === undefined ? 'error' : String(sample.statusCode);
    statusCodes[code] = (statusCodes[code] || 0) + 1;
    if (!sample.ok) {
      const reason = failureReason(sample);
      failures.set(reason, (failures.get(reason) || 0) + 1);
    }
  }
  const failed = samples.filter(sample => !sample.ok).length;
  return {
    virtualUsers,
    durationMs,
    requests: samples.length,
    failed,
    errorRate: samples.length ? failed / samples.length : 0,
    throughput: durationMs > 0 ? Math.round((samples.length / (durationMs / 1000)) * 10) / 10 : 0,
    latency: latencyStats(samples),
    byRequest: [...byRequest.values()].map(group => {
      const phases = meanPhases(group);
      const sized = group.filter(sample => sample.bytes !== undefined).map(sample => sample.bytes!);
      return {
        requestId: group[0].requestId,
        name: group[0].name,
        ...latencyStats(group),
        ...(phases ? { phases } : {}),
        ...(sized.length ? { bytes: Math.round(mean(sized)) } : {}),
      };
    }),
    timeline,
    statusCodes,
    failures: [...failures.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    stopped,
  };
}

export interface LoadThresholds {
  // milliseconds
  p95?: number;
  p99?: number;
  // 0 to 1
  errorRate?: number;
}

export interface ThresholdCheck {
  passed: boolean;
  // what was measured against what was allowed
  message: string;
}

const percent = (rate: number) => `${(rate * 100).toFixed(2)}%`;

// each threshold set, and whether the summary kept it
export function checkThresholds(summary: LoadSummary, thresholds: LoadThresholds): ThresholdCheck[] {
  const checks: ThresholdCheck[] = [];
  for (const key of ['p95', 'p99'] as const) {
    const limit = thresholds[key];
    if (limit !== undefined) {
      const value = summary.latency[key];
      checks.push(value > limit
        ? { passed: false, message: `${key} ${value} ms is over ${limit} ms` }
        : { passed: true, message: `${key} ${value} ms is within ${limit} ms` });
    }
  }
  if (thresholds.errorRate !== undefined) {
    checks.push(summary.errorRate > thresholds.errorRate
      ? { passed: false, message: `${percent(summary.errorRate)} of requests failed, over ${percent(thresholds.errorRate)}` }
      : { passed: true, message: `${percent(summary.errorRate)} of requests failed, within ${percent(thresholds.errorRate)}` });
  }
  return checks;
}

// what a summary breaks of its thresholds, as `insomnium-server load` reports it
export const brokenThresholds = (summary: LoadSummary, thresholds: LoadThresholds): string[] =>
  checkThresholds(summary, thresholds).filter(check => !check.passed).map(check => check.message);
