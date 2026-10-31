import { describe, expect, it } from '@jest/globals';
import Papa from 'papaparse';

import { phaseDurations, timingPhases } from '../../common/timings';
import { csvReport, htmlReport, jsonReport, resultName } from '../run-files';
import { requestRunStats } from '../run-stats';
import type { RunResult, RunSummary } from '../runner';

// resolved at 1 ms, connected at 3, TLS done at 9, first byte at 40
const timings = { dns: 1, connect: 3, tls: 9, firstByte: 40 };

const result = (fields: Partial<RunResult>): RunResult => ({
  iteration: 1, requestId: 'req_a', name: 'List', folders: ['Users'], method: 'GET', url: 'https://api.example.com/users',
  statusCode: 200, statusMessage: 'OK', elapsedTime: 50, timings, bytes: 2048, httpVersion: '2', assertions: [], passed: true,
  ...fields,
});

const summary = (results: RunResult[]): RunSummary => ({
  iterations: Math.max(...results.map(({ iteration }) => iteration)),
  results,
  requests: { total: results.length, failed: results.filter(({ passed }) => !passed).length },
  assertions: { total: 0, failed: 0 },
  elapsedTime: 1234,
  bailed: false,
  stopped: false,
});

describe('timing phases', () => {
  it("splits libcurl's times into what each part of the exchange took", () => {
    expect(phaseDurations(timings, 50)).toEqual({ dns: 1, connect: 2, tls: 6, wait: 31, download: 10 });
    // no TLS: waiting starts when the connection is made
    expect(phaseDurations({ dns: 1, connect: 3, tls: 0, firstByte: 40 }, 50)).toEqual({ dns: 1, connect: 2, tls: 0, wait: 37, download: 10 });
    expect(timingPhases({ dns: 1, connect: 3, tls: 0, firstByte: 40 }, 50).map(([phase]) => phase)).toEqual(['DNS lookup', 'Connecting', 'Waiting (time to first byte)', 'Download']);
  });
});

describe("a run's numbers for each request", () => {
  const run = [
    result({ iteration: 1, elapsedTime: 90, timings: { dns: 20, connect: 40, tls: 70, firstByte: 85 } }),
    result({ iteration: 2, elapsedTime: 50 }),
    result({ iteration: 3, elapsedTime: 30, timings: { dns: 0, connect: 0, tls: 0, firstByte: 25 }, passed: false }),
    result({ iteration: 1, requestId: 'req_b', name: 'Create', folders: [], method: 'POST', elapsedTime: undefined, timings: undefined, bytes: undefined, error: 'render failed', passed: false }),
  ];

  it('gives the percentiles, spread, phases, size and the cold start of each', () => {
    const [list, create] = requestRunStats(run, resultName);
    expect(list).toMatchObject({ requestId: 'req_a', name: 'Users / List', method: 'GET', count: 3, failed: 1, min: 30, p50: 50, p95: 90, max: 90, mean: 56.7, bytes: 2048, first: 90, warmP50: 30 });
    expect(list.sd).toBe(24.9);
    // the mean of each phase over the three sends
    expect(list.phases).toEqual({ dns: 7, connect: 7.3, tls: 12, wait: 23.7, download: 6.7 });
    // a send that never happened counts, but has no time
    expect(create).toMatchObject({ name: 'Create', count: 1, failed: 1, p50: 0 });
    expect(create.phases).toBeUndefined();
    expect(create.bytes).toBeUndefined();
    expect(create.first).toBeUndefined();
  });

  it('leaves out the cold start when there is one iteration', () => {
    expect(requestRunStats([result({})], resultName)[0].first).toBeUndefined();
  });
});

describe('run reports', () => {
  const run = summary([
    result({ iteration: 1 }),
    result({ iteration: 2, elapsedTime: 70, passed: false, assertions: [{ id: 'x', passed: false, message: 'Response time (ms) is less than 60' }] }),
    result({ iteration: 2, requestId: 'req_b', name: '=cmd|"/c calc"!A1', folders: [], url: 'https://api.example.com/<script>', statusCode: undefined, elapsedTime: undefined, timings: undefined, bytes: undefined, error: 'Could not connect <here>', passed: false }),
  ]);

  it('JSON: each result with its phases, and each request over the run', () => {
    const report = JSON.parse(jsonReport(run, 'API'));
    expect(report.results[0].phases).toEqual({ dns: 1, connect: 2, tls: 6, wait: 31, download: 10 });
    expect(report.results[2].phases).toBeUndefined();
    expect(report.byRequest.map(({ name, count, failed }: { name: string; count: number; failed: number }) => ({ name, count, failed }))).toEqual([
      { name: 'Users / List', count: 2, failed: 1 },
      { name: '=cmd|"/c calc"!A1', count: 1, failed: 1 },
    ]);
  });

  it('CSV: a row per send, safe to open in a spreadsheet', () => {
    const { data } = Papa.parse<Record<string, string>>(csvReport(run), { header: true, skipEmptyLines: true });
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ iteration: '1', request: 'Users / List', status: '200', passed: 'true', time: '50', dns: '1', connect: '2', tls: '6', wait: '31', download: '10', bytes: '2048', httpVersion: '2' });
    expect(data[1].failedAssertions).toBe('Response time (ms) is less than 60');
    // a name that looks like a formula is escaped, so a spreadsheet won't run it
    expect(data[2].request.startsWith("'=")).toBe(true);
    expect(data[2]).toMatchObject({ status: '', time: '', error: 'Could not connect <here>' });
  });

  it('HTML: one page with the numbers, escaped, and no scripts', () => {
    const html = htmlReport(run, 'Users & <Admins>', new Date('2026-10-31T12:00:00Z'));
    expect(html).toContain('<title>Users &amp; &lt;Admins&gt;: run report</title>');
    expect(html).toContain('2026-10-31 12:00:00 UTC');
    expect(html).toContain('1 of 3</b>requests passed');
    expect(html).toContain('First / later p50');
    expect(html).toContain('Users / List');
    expect(html).toContain('Could not connect &lt;here&gt;');
    expect(html).toContain('Response time (ms) is less than 60');
    // the mean of its two sends, 50 and 70 ms, which differ in their download
    expect(html).toContain('aria-label="DNS lookup 1.0 ms, Connecting 2.0 ms, TLS handshake 6.0 ms, Waiting (time to first byte) 31.0 ms, Download 20.0 ms"');
    expect(html).not.toMatch(/<script|https?:\/\/(?!api\.example\.com)/);
    expect(html).not.toContain('<here>');
  });
});
