// A load test's numbers (network/load-test.ts): latency percentiles,
// throughput and errors, overall and for each request.

export interface LoadSample {
  requestId: string;
  name: string;
  // milliseconds: libcurl's total time, or until the send failed
  elapsed: number;
  // sent, below 400 (or as its own status assertion wants), and every assertion passed
  ok: boolean;
  statusCode?: number;
  error?: string;
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
  byRequest: (LatencyStats & { requestId: string; name: string })[];
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

export function summarizeLoad(samples: LoadSample[], { virtualUsers, durationMs, stopped }: { virtualUsers: number; durationMs: number; stopped: boolean }): LoadSummary {
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
    byRequest: [...byRequest.values()].map(group => ({ requestId: group[0].requestId, name: group[0].name, ...latencyStats(group) })),
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

// what a summary breaks of its thresholds, as `insomnium-server load` reports it
export function brokenThresholds(summary: LoadSummary, thresholds: LoadThresholds): string[] {
  const broken: string[] = [];
  if (thresholds.p95 !== undefined && summary.latency.p95 > thresholds.p95) {
    broken.push(`p95 ${summary.latency.p95} ms is over ${thresholds.p95} ms`);
  }
  if (thresholds.p99 !== undefined && summary.latency.p99 > thresholds.p99) {
    broken.push(`p99 ${summary.latency.p99} ms is over ${thresholds.p99} ms`);
  }
  if (thresholds.errorRate !== undefined && summary.errorRate > thresholds.errorRate) {
    broken.push(`${(summary.errorRate * 100).toFixed(2)}% of requests failed, over ${(thresholds.errorRate * 100).toFixed(2)}%`);
  }
  return broken;
}
