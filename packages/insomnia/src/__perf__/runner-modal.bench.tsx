// npm run bench -- runner-modal
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import type { RunOptions, RunResult } from '../network/runner';
import { report } from './seed';

jest.mock('react-router-dom', () => ({
  ...(jest.requireActual('react-router-dom') as object),
  useNavigate: () => () => {},
  useParams: () => ({}),
  useRouteLoaderData: () => ({ activeEnvironment: { name: 'Base Environment' } }),
}));
jest.mock('react-aria', () => ({
  ...(jest.requireActual('react-aria') as object),
  OverlayContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../ui/components/base/modal', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { forwardRef, useImperativeHandle } = require('react') as typeof import('react');
  return { ...(jest.requireActual('../ui/components/base/modal') as object), Modal: forwardRef(({ children }: { children: React.ReactNode }, ref) => {
    useImperativeHandle(ref, () => ({ show: () => {}, hide: () => {} }));
    return <div>{children}</div>;
  }) };
});
jest.mock('../ui/components/load-test-panel', () => ({ LoadTestPanel: () => null }));

// a run of `results` results, each arriving on its own (as each send ends)
let results = 0;
jest.mock('../network/runner', () => ({
  notRunnable: () => '',
  listRunnableRequests: async () => [{ request: { _id: 'req_1', name: 'Get', method: 'GET', type: 'Request' }, folders: [] }],
  runRequests: async (_: unknown, { onResult }: RunOptions) => {
    const all: RunResult[] = [];
    for (let i = 1; i <= results; i++) {
      const result = { iteration: i, requestId: 'req_1', name: 'Get', folders: [], method: 'GET', statusCode: 200, statusMessage: 'OK', elapsedTime: 5, assertions: [{ passed: true, name: 'status is 200' }], passed: true } as unknown as RunResult;
      all.push(result);
      onResult?.(result);
      await new Promise(resolve => setTimeout(resolve));
    }
    return { iterations: results, results: all, requests: { total: results, failed: 0 }, assertions: { total: results, failed: 0 }, elapsedTime: 0, bailed: false, stopped: false };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RunnerModal } = require('../ui/components/modals/runner-modal');

describe('the runner window, as results come in', () => {
  for (const count of [250, 1000, 2000]) {
    it(`${count} results`, async () => {
      results = count;
      const { findByRole, findByTestId } = render(<RunnerModal parentId="wrk_1" name="Collection" />);
      const run = await findByRole('button', { name: /^Run 1 request/ });
      const start = performance.now();
      await act(async () => {
        fireEvent.click(run);
      });
      const summary = await findByTestId('run-summary');
      await waitFor(() => expect(summary.textContent).toContain('passed'), { timeout: 600_000, interval: 10 });
      report(`a run of ${count} results, shown as they came`, performance.now() - start);
      expect(summary.textContent).toContain(`${count} of ${count} requests passed`);
    }, 600_000);
  }
});
