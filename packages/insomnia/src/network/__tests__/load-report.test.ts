import { describe, expect, it } from '@jest/globals';
import Papa from 'papaparse';

import { loadCsvReport, loadHtmlReport, loadJsonReport } from '../load-report';
import { checkThresholds, type LoadSummary, summarizeLoad, TimelineRecorder } from '../load-stats';
import { describeTimeline, timelineGeometry } from '../timeline-chart';

describe('a load test second by second', () => {
  it('counts each send into its second, with the users then and the latency percentiles', () => {
    const timeline = new TimelineRecorder();
    timeline.record(100, { elapsed: 10, ok: true }, 1);
    timeline.record(900, { elapsed: 30, ok: false }, 2);
    // nothing in the second second
    timeline.record(2500, { elapsed: 20, ok: true }, 2);
    expect(timeline.points()).toEqual([
      { second: 0, users: 2, requests: 2, failed: 1, p50: 10, p95: 30 },
      { second: 1, users: 0, requests: 0, failed: 0, p50: 0, p95: 0 },
      { second: 2, users: 2, requests: 1, failed: 0, p50: 20, p95: 20 },
    ]);
  });

  it('keeps counting a busy second past the latencies it keeps', () => {
    const timeline = new TimelineRecorder();
    for (let index = 0; index < 1200; index++) {
      timeline.record(10, { elapsed: 5, ok: index % 4 !== 0 }, 3);
    }
    expect(timeline.points()[0]).toEqual({ second: 0, users: 3, requests: 1200, failed: 300, p50: 5, p95: 5 });
  });

  it('places the bars and lines on their own scales, and skips idle seconds in the lines', () => {
    const chart = timelineGeometry([
      { second: 0, users: 1, requests: 10, failed: 5, p50: 50, p95: 100 },
      { second: 1, users: 1, requests: 0, failed: 0, p50: 0, p95: 0 },
      { second: 2, users: 1, requests: 5, failed: 0, p50: 25, p95: 50 },
    ], 300, 180);
    expect(chart).toMatchObject({ maxRequests: 10, maxLatency: 100, top: 12, bottom: 160 });
    // the tallest bar reaches the top; half of it failed
    expect(chart.bars[0]).toMatchObject({ x: 1, width: 98, y: 12, failedY: 86 });
    expect(chart.bars[1].y).toBe(160);
    expect(chart.p95).toBe('50,12 250,86');
    expect(chart.p50).toBe('50,86 250,123');
  });

  it('describes the chart for a screen reader', () => {
    expect(describeTimeline([])).toBe('Nothing sent yet');
    expect(describeTimeline([
      { second: 0, users: 1, requests: 4, failed: 0, p50: 5, p95: 9 },
      { second: 1, users: 2, requests: 8, failed: 2, p50: 6, p95: 40 },
    ])).toBe("2 seconds: up to 8 requests a second; the slowest second's p95 was 40 ms, at 1 s; 2 failed");
  });
});

describe('load test thresholds', () => {
  const summary = { latency: { p95: 250, p99: 900 }, errorRate: 0.02 } as LoadSummary;

  it('says which held and which broke', () => {
    expect(checkThresholds(summary, { p95: 300, p99: 500, errorRate: 0.01 })).toEqual([
      { passed: true, message: 'p95 250 ms is within 300 ms' },
      { passed: false, message: 'p99 900 ms is over 500 ms' },
      { passed: false, message: '2.00% of requests failed, over 1.00%' },
    ]);
    expect(checkThresholds(summary, {})).toEqual([]);
  });
});

describe('load test reports', () => {
  const timings = { dns: 1, connect: 3, tls: 0, firstByte: 40 };
  const summary = summarizeLoad([
    { requestId: 'a', name: 'List <users>', elapsed: 50, ok: true, statusCode: 200, timings, bytes: 2048 },
    { requestId: 'a', name: 'List <users>', elapsed: 70, ok: true, statusCode: 200, timings, bytes: 2048 },
    { requestId: 'b', name: 'Create', elapsed: 20, ok: false, statusCode: 500 },
  ], {
    virtualUsers: 2,
    durationMs: 2000,
    stopped: false,
    timeline: [
      { second: 0, users: 2, requests: 2, failed: 1, p50: 20, p95: 50 },
      { second: 1, users: 2, requests: 1, failed: 0, p50: 70, p95: 70 },
    ],
  });

  it('gives each request its mean phases and size', () => {
    expect(summary.byRequest[0]).toMatchObject({ name: 'List <users>', phases: { dns: 1, connect: 2, tls: 0, wait: 37, download: 20 }, bytes: 2048 });
    expect(summary.byRequest[1].phases).toBeUndefined();
  });

  it('JSON: the summary, its seconds, and the thresholds held and broken', () => {
    const report = JSON.parse(loadJsonReport(summary, 'API', { p95: 60 }));
    expect(report).toMatchObject({ name: 'API', requests: 3, thresholds: { p95: 60 }, broken: ['p95 70 ms is over 60 ms'], checks: [{ passed: false, message: 'p95 70 ms is over 60 ms' }] });
    expect(report.timeline).toHaveLength(2);
  });

  it('CSV: a row a second', () => {
    const { data } = Papa.parse<Record<string, string>>(loadCsvReport(summary), { header: true, skipEmptyLines: true });
    expect(data).toEqual([
      { second: '0', users: '2', requests: '2', failed: '1', p50: '20', p95: '50' },
      { second: '1', users: '2', requests: '1', failed: '0', p50: '70', p95: '70' },
    ]);
  });

  it('HTML: the thresholds, the chart and each request, escaped, and no scripts', () => {
    const html = loadHtmlReport(summary, 'Shop & co', { p95: 100, errorRate: 0.1 }, new Date('2026-10-31T12:00:00Z'));
    expect(html).toContain('<title>Shop &amp; co: load test</title>');
    expect(html).toContain('2 users for 2.0 s · 2026-10-31 12:00:00 UTC');
    expect(html).toContain('<li class="good">p95 70 ms is within 100 ms</li>');
    expect(html).toContain('<li class="bad">33.33% of requests failed, over 10.00%</li>');
    expect(html).toContain('aria-label="2 seconds: up to 2 requests a second; the slowest second\'s p95 was 70 ms, at 1 s; 1 failed"');
    expect(html).toContain('<title>0–1 s: 2 sent, 1 failed, p50 20 ms, p95 50 ms, 2 users</title>');
    expect(html).toContain('List &lt;users&gt;');
    expect(html).toContain('aria-label="DNS lookup 1.0 ms, Connecting 2.0 ms, Waiting (time to first byte) 37.0 ms, Download 20.0 ms"');
    expect(html).toContain('500 × 1');
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/);
    expect(html).not.toContain('<users>');
  });
});
