import { describe, expect, it } from '@jest/globals';

import { formatComparison } from '../../server/report';
import { compareRuns, describeSlower, parseBaseline } from '../run-compare';
import { htmlReport, jsonReport } from '../run-files';
import type { RequestRunStats } from '../run-stats';
import type { RunSummary } from '../runner';

const stats = (requestId: string, name: string, p50: number, p95: number) =>
  ({ requestId, name, method: 'GET', count: 5, failed: 0, min: p50, mean: p50, p50, p90: p95, p95, p99: p95, max: p95, sd: 1 }) as RequestRunStats;

describe('comparing a run with a baseline', () => {
  const baseline = parseBaseline(JSON.stringify({
    name: 'API',
    byRequest: [
      { requestId: 'req_a', name: 'List', p50: 90, p95: 100 },
      { requestId: 'req_b', name: 'Create', p50: 9, p95: 10 },
      { name: 'Renamed later', p50: 200, p95: 300 },
      { requestId: 'req_gone', name: 'Gone', p50: 5, p95: 5 },
    ],
  }));

  it('flags a request whose p95 grew past the share and the noise floor, and one that got faster', () => {
    const comparison = compareRuns([
      // 30% slower: flagged
      stats('req_a', 'List', 100, 130),
      // 40% slower, but only 4 ms: within the noise of a fast request
      stats('req_b', 'Create', 10, 14),
      // matched by name, its id new; 50% faster
      stats('req_new_id', 'Renamed later', 100, 150),
      // not in the baseline
      stats('req_c', 'Brand new', 1, 2),
    ], baseline);

    expect(comparison.requests).toEqual([
      { requestId: 'req_a', name: 'List', before: { p50: 90, p95: 100 }, now: { p50: 100, p95: 130 }, change: 0.3, slower: true, faster: false },
      { requestId: 'req_b', name: 'Create', before: { p50: 9, p95: 10 }, now: { p50: 10, p95: 14 }, change: 0.4, slower: false, faster: false },
      { requestId: 'req_new_id', name: 'Renamed later', before: { p50: 200, p95: 300 }, now: { p50: 100, p95: 150 }, change: -0.5, slower: false, faster: true },
      { requestId: 'req_c', name: 'Brand new', now: { p50: 1, p95: 2 }, slower: false, faster: false },
    ]);
    expect(comparison).toMatchObject({ slower: 1, missing: ['Gone'] });
    expect(describeSlower(comparison)).toEqual(['List: p95 100 ms → 130 ms (+30%)']);
  });

  it('takes its own limits', () => {
    const now = [stats('req_a', 'List', 100, 130)];
    expect(compareRuns(now, baseline, { maxSlowdown: 0.5 }).slower).toBe(0);
    expect(compareRuns([stats('req_b', 'Create', 10, 14)], baseline, { minChangeMs: 1 }).slower).toBe(1);
  });

  it('shows in the reports, and the console says what changed', () => {
    const summary: RunSummary = {
      iterations: 1, requests: { total: 1, failed: 0 }, assertions: { total: 0, failed: 0 }, elapsedTime: 10, bailed: false, stopped: false,
      results: [{ iteration: 1, requestId: 'req_a', name: 'List', folders: [], method: 'GET', statusCode: 200, elapsedTime: 130, assertions: [], passed: true }],
    };
    const comparison = compareRuns([stats('req_a', 'List', 100, 130), stats('req_x', 'Fresh', 1, 2)], baseline);
    const html = htmlReport(summary, 'API', new Date('2026-10-31T12:00:00Z'), comparison);
    expect(html).toContain('<th class="n">p95 vs baseline</th>');
    expect(html).toContain('<td class="n bad">+30% <span class="faint">(100.0 ms → 130.0 ms)</span></td>');
    expect(html).toContain('1</b>request slower than the baseline');
    expect(html).toContain('In the baseline, not run here: Create, Renamed later, Gone.');
    expect(htmlReport(summary, 'API', new Date())).not.toContain('vs baseline');
    expect(JSON.parse(jsonReport(summary, 'API', comparison)).comparison).toMatchObject({ slower: 1 });
    expect(formatComparison(comparison, 'last.json')).toBe([
      'Against last.json: 1 slower',
      '  ✗ List: p95 100 ms → 130 ms (+30%)',
      '  In the baseline, not run here: Create, Renamed later, Gone',
    ].join('\n'));
  });

  it("refuses what isn't a run report", () => {
    expect(() => parseBaseline('nope')).toThrow('the baseline is not JSON');
    expect(() => parseBaseline('{"name":"x"}')).toThrow('the baseline has no request numbers (byRequest)');
    expect(() => parseBaseline('{"byRequest":[{"name":"x"}]}')).toThrow('byRequest');
  });
});
