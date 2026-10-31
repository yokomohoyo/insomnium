import { describe, expect, it } from '@jest/globals';

import { summarizeLoad } from '../../network/load-stats';
import { formatLoadSummary, parseDuration, parseLoadConfig } from '../load-test';

describe('insomnium-server load', () => {
  it('reads its options', () => {
    const config = parseLoadConfig(
      ['--collection', 'api.yaml', '--users', '20', '--duration', '2m', '--ramp-up', '10s', '--think-time', '250ms', '--max-p95', '300', '--max-errors', '0.5', '--json', 'load.json', '--html', 'load.html', '--csv', 'load.csv'],
      { INSOMNIUM_VAR_token: 'secret', INSOMNIUM_ALLOWED_HOSTS: 'api.example.com' },
    );

    expect(config).toMatchObject({
      collections: ['api.yaml'],
      virtualUsers: 20,
      durationMs: 120_000,
      rampUpMs: 10_000,
      thinkTimeMs: 250,
      thresholds: { p95: 300, errorRate: 0.005 },
      json: 'load.json',
      html: 'load.html',
      csv: 'load.csv',
      variables: { token: 'secret' },
      allowedHosts: ['api.example.com'],
    });
    expect(parseLoadConfig(['--collection', 'api.yaml'], {})).toMatchObject({ virtualUsers: 5, durationMs: 30_000, thresholds: {}, allowedHosts: ['*'] });
  });

  it('refuses what it cannot run', () => {
    expect(() => parseLoadConfig([], {})).toThrow('Give at least one --collection or --repo');
    expect(() => parseLoadConfig(['--collection', 'a.yaml', '--users', '101'], {})).toThrow('--users must be a number from 1 to 100');
    expect(() => parseLoadConfig(['--collection', 'a.yaml', '--users', '2.5'], {})).toThrow('--users must be a whole number');
    expect(() => parseLoadConfig(['--collection', 'a.yaml', '--duration', '2h'], {})).toThrow('--duration must be a time such as 30s');
    expect(() => parseLoadConfig(['--collection', 'a.yaml', '--duration', '500ms'], {})).toThrow('--duration must be from 1s to 60m');
    expect(() => parseLoadConfig(['--collection', 'a.yaml', '--users'], {})).toThrow('--users needs a value');
  });

  it('reads times', () => {
    expect([parseDuration('--duration', '45'), parseDuration('--duration', '1.5s'), parseDuration('--duration', '3m'), parseDuration('--duration', '750ms')]).toEqual([45_000, 1500, 180_000, 750]);
  });

  it('prints a table of the results', () => {
    const text = formatLoadSummary(summarizeLoad([
      { requestId: 'a', name: 'list pets', elapsed: 12, ok: true, statusCode: 200 },
      { requestId: 'a', name: 'list pets', elapsed: 18, ok: false, statusCode: 503 },
    ], { virtualUsers: 1, durationMs: 1000, stopped: false }));

    expect(text.split('\n')).toEqual([
      'Request       Sent   Failed      Mean       p50       p90       p95       p99       Max',
      'list pets        2        1     15 ms     12 ms     18 ms     18 ms     18 ms     18 ms',
      'All              2        1     15 ms     12 ms     18 ms     18 ms     18 ms     18 ms',
      '',
      '2 requests in 1.0 s from 1 user · 2/s · 1 failed (50.00%)',
      'Status codes: 200 × 1, 503 × 1',
      '  ✗ 1 × HTTP 503',
    ]);
  });
});
