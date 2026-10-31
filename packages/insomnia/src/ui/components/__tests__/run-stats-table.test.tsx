import { describe, expect, it } from '@jest/globals';
import { render, within } from '@testing-library/react';
import React from 'react';

import type { RequestRunStats } from '../../../network/run-stats';
import { RunStatsTable } from '../run-stats-table';

const row = (fields: Partial<RequestRunStats>): RequestRunStats => ({
  requestId: 'req_a', name: 'Users / List', method: 'GET', count: 3, failed: 1,
  min: 30, mean: 56.7, p50: 50, p90: 90, p95: 90, p99: 90, max: 90, sd: 24.9,
  phases: { dns: 7, connect: 7.3, tls: 0, wait: 23.7, download: 6.7 }, bytes: 2048, first: 90, warmP50: 30,
  ...fields,
});

describe('the runner summary', () => {
  it('shows each request over the run, with where its time goes', () => {
    const view = render(<RunStatsTable stats={[row({}), row({ requestId: 'req_b', name: 'Create', method: 'POST', failed: 0, phases: undefined, bytes: undefined, first: undefined, warmP50: undefined })]} />);
    const table = view.getByRole('table', { name: 'Each request over the run' });
    expect(within(table).getByRole('columnheader', { name: 'First / later' })).toBeTruthy();

    const list = within(table).getByRole('row', { name: 'Users / List' });
    const cells = within(list).getAllByRole('cell').map(cell => cell.textContent);
    expect(cells.slice(0, 9)).toEqual(['GET Users / List', '3', '1', '50 ms', '90 ms', '90 ms', '24.9 ms', '90 ms / 30 ms', '2.0 kB']);
    // the bar names its phases, leaving out a TLS handshake there wasn't
    expect(within(list).getByRole('img').getAttribute('aria-label')).toBe('DNS lookup 7 ms, Connecting 7.3 ms, Waiting (time to first byte) 23.7 ms, Download 6.7 ms');

    // a request with no timed sends has no bar and no size
    const create = within(table).getByRole('row', { name: 'Create' });
    expect(within(create).queryByRole('img')).toBeNull();
  });

  it('leaves out the cold start column with one iteration', () => {
    const view = render(<RunStatsTable stats={[row({ first: undefined, warmP50: undefined })]} />);
    expect(view.queryByRole('columnheader', { name: 'First / later' })).toBeNull();
  });
});
