import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';
import fs from 'fs';
import path from 'path';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { brokenThresholds, type LoadSummary, percentile, summarizeLoad } from '../load-stats';
import { runLoadTest } from '../load-test';
import { listRunnableRequests } from '../runner';

// a load test sends more than the mocked ids go around (uuid itself is ES modules)
jest.mock('uuid', () => {
  const { randomUUID } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v1: randomUUID, v4: randomUUID };
});

window.app = electron.app;

describe('load test numbers', () => {
  it('takes nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect([percentile(values, 50), percentile(values, 95), percentile(values, 99), percentile(values, 100)]).toEqual([50, 95, 99, 100]);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });

  it('sums up the samples, overall and by request', () => {
    const summary = summarizeLoad([
      { requestId: 'a', name: 'list', elapsed: 10, ok: true, statusCode: 200 },
      { requestId: 'a', name: 'list', elapsed: 30, ok: true, statusCode: 200 },
      { requestId: 'b', name: 'create', elapsed: 20, ok: false, statusCode: 500 },
      { requestId: 'b', name: 'create', elapsed: 40, ok: false, error: 'Could not connect\nmore' },
    ], { virtualUsers: 2, durationMs: 2000, stopped: false });

    expect(summary).toMatchObject({ requests: 4, failed: 2, errorRate: 0.5, throughput: 2, statusCodes: { 200: 2, 500: 1, error: 1 } });
    expect(summary.latency).toEqual({ count: 4, failed: 2, min: 10, mean: 25, p50: 20, p90: 40, p95: 40, p99: 40, max: 40 });
    expect(summary.byRequest.map(({ name, count, failed, mean }) => ({ name, count, failed, mean }))).toEqual([
      { name: 'list', count: 2, failed: 0, mean: 20 },
      { name: 'create', count: 2, failed: 2, mean: 30 },
    ]);
    expect(summary.failures).toEqual([{ reason: 'HTTP 500', count: 1 }, { reason: 'Could not connect', count: 1 }]);
  });

  it('says which thresholds a summary breaks', () => {
    const summary = { latency: { p95: 250, p99: 900 }, errorRate: 0.02 } as LoadSummary;
    expect(brokenThresholds(summary, { p95: 300, p99: 500, errorRate: 0.01 })).toEqual([
      'p99 900 ms is over 500 ms',
      '2.00% of requests failed, over 1.00%',
    ]);
    expect(brokenThresholds(summary, {})).toEqual([]);
  });
});

describe('runLoadTest()', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Load' }))._id;
    await models.request.create({ parentId: workspaceId, name: 'ok', url: 'http://localhost/ok', metaSortKey: 1 });
    await models.request.create({ parentId: workspaceId, name: 'fails', url: 'http://localhost/fails', metaSortKey: 2, assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '201' }] });
  });

  it('sends the requests from each user until the time is up, and keeps nothing of them', async () => {
    const progress: LoadSummary[] = [];
    const summary = await runLoadTest(await listRunnableRequests(workspaceId), { virtualUsers: 3, durationMs: 1500, thinkTimeMs: 5, onProgress: snapshot => progress.push(snapshot) });

    expect(summary.requests).toBeGreaterThanOrEqual(6);
    expect(summary.virtualUsers).toBe(3);
    const [ok, fails] = summary.byRequest;
    expect([ok.name, fails.name]).toEqual(['ok', 'fails']);
    expect(ok.failed).toBe(0);
    expect(fails.failed).toBe(fails.count);
    expect(summary.failures).toEqual([{ reason: 'An assertion failed', count: fails.count }]);
    expect(summary.statusCodes).toEqual({ 200: summary.requests });
    expect(summary.stopped).toBe(false);
    expect(progress.length).toBeGreaterThan(0);

    expect(await models.response.all()).toEqual([]);
    const responses = path.join(electron.app.getPath('userData'), 'responses');
    expect(fs.existsSync(responses) ? fs.readdirSync(responses) : []).toEqual([]);
  });

  it('stops when asked', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const summary = await runLoadTest(await listRunnableRequests(workspaceId), { virtualUsers: 2, durationMs: 30_000, rampUpMs: 10_000, signal: controller.signal });

    expect(summary.stopped).toBe(true);
    expect(summary.durationMs).toBeLessThan(5000);
  });

  it('refuses a test it cannot run', async () => {
    const requests = await listRunnableRequests(workspaceId);
    await expect(runLoadTest(requests, { virtualUsers: 0, durationMs: 1000 })).rejects.toThrow('Virtual users must be a whole number from 1 to 100');
    await expect(runLoadTest(requests, { virtualUsers: 1, durationMs: 10 })).rejects.toThrow('The duration must be from 1 second');
    await expect(runLoadTest([], { virtualUsers: 1, durationMs: 1000 })).rejects.toThrow('There are no requests to load test');
  });
});
