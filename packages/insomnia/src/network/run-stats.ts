import { type PhaseDurations, phaseDurations } from '../common/timings';
import { latencyStats, type LatencyStats, percentile } from './load-stats';
import type { RunResult } from './runner';

// A run's numbers for each request, over its iterations: what the runner's
// summary and its reports show an API developer.

export interface RequestRunStats extends LatencyStats {
  requestId: string;
  // with its folders, as the results name it
  name: string;
  method: string;
  // the population standard deviation of its times
  sd: number;
  // the mean of each phase, from the sends libcurl timed
  phases?: PhaseDurations;
  // the mean body size received, in bytes
  bytes?: number;
  // the first iteration's time and the median of the others: what a cold
  // start (a new connection, a cold cache) costs, with two iterations or more
  first?: number;
  warmP50?: number;
}

const round = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function requestRunStats(results: RunResult[], nameOf: (result: RunResult) => string): RequestRunStats[] {
  const groups = new Map<string, RunResult[]>();
  for (const result of results) {
    const group = groups.get(result.requestId);
    if (group) {
      group.push(result);
    } else {
      groups.set(result.requestId, [result]);
    }
  }
  return [...groups.values()].map(group => {
    // a send that never happened (a render error) has no time to count
    const timed = group.filter((result): result is RunResult & { elapsedTime: number } => result.elapsedTime !== undefined);
    const latency = latencyStats(timed.map(result => ({ requestId: result.requestId, name: result.name, elapsed: result.elapsedTime, ok: result.passed })));
    const times = timed.map(result => result.elapsedTime);
    const withTimings = timed.filter(result => result.timings);
    const phases = withTimings.map(result => phaseDurations(result.timings!, result.elapsedTime));
    const sized = group.filter(result => result.bytes !== undefined).map(result => result.bytes!);
    const first = timed.find(result => result.iteration === 1);
    const warm = timed.filter(result => result.iteration > 1).map(result => result.elapsedTime).sort((a, b) => a - b);
    return {
      ...latency,
      // every result counts, timed or not
      count: group.length,
      failed: group.filter(result => !result.passed).length,
      requestId: group[0].requestId,
      name: nameOf(group[0]),
      method: group[0].method,
      sd: times.length ? round(Math.sqrt(mean(times.map(time => (time - mean(times)) ** 2)))) : 0,
      ...(phases.length ? {
        phases: {
          dns: round(mean(phases.map(phase => phase.dns))),
          connect: round(mean(phases.map(phase => phase.connect))),
          tls: round(mean(phases.map(phase => phase.tls))),
          wait: round(mean(phases.map(phase => phase.wait))),
          download: round(mean(phases.map(phase => phase.download))),
        },
      } : {}),
      ...(sized.length ? { bytes: Math.round(mean(sized)) } : {}),
      ...(first && warm.length ? { first: round(first.elapsedTime), warmP50: round(percentile(warm, 50)) } : {}),
    };
  });
}
