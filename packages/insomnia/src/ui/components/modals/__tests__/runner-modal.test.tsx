import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import React from 'react';

import type { RunOptions, RunResult } from '../../../../network/runner';

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
jest.mock('../../base/modal', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { forwardRef, useImperativeHandle } = require('react') as typeof import('react');
  return { ...(jest.requireActual('../../base/modal') as object), Modal: forwardRef(({ children }: { children: React.ReactNode }, ref) => {
    useImperativeHandle(ref, () => ({ show: () => {}, hide: () => {} }));
    return <div>{children}</div>;
  }) };
});
jest.mock('../../load-test-panel', () => ({ LoadTestPanel: () => null }));

// a run whose results come in a burst, then one more a while later
jest.mock('../../../../network/runner', () => ({
  notRunnable: () => '',
  listRunnableRequests: async () => [{ request: { _id: 'req_1', name: 'Get', method: 'GET', type: 'Request' }, folders: [] }],
  runRequests: async (_: unknown, { onResult }: RunOptions) => {
    const result = (iteration: number) => ({ iteration, requestId: 'req_1', name: 'Get', folders: [], method: 'GET', statusCode: 200, statusMessage: 'OK', elapsedTime: 5, assertions: [], passed: iteration !== 3 }) as unknown as RunResult;
    const all = [1, 2, 3].map(result);
    all.forEach(r => onResult?.(r));
    await new Promise(resolve => setTimeout(resolve, 250));
    all.push(result(4));
    onResult?.(all[3]);
    return { iterations: 4, results: all, requests: { total: 4, failed: 1 }, assertions: { total: 0, failed: 0 }, elapsedTime: 0, bailed: false, stopped: false };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RunnerModal } = require('../runner-modal');

describe('<RunnerModal />', () => {
  it('shows every result, those that came in a burst together, and the last at the end', async () => {
    const { findByRole, findByTestId, getByRole } = render(<RunnerModal parentId="wrk_1" name="Collection" />);
    const run = await findByRole('button', { name: /^Run 1 request/ });
    await act(async () => {
      fireEvent.click(run);
    });
    const list = getByRole('list', { name: 'Run results' });

    // the burst, while the run goes on
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect((await findByTestId('run-summary')).textContent).toBe('Running: 3 sent');

    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
    expect((await findByTestId('run-summary')).textContent).toContain('3 of 4 requests passed');
    expect(within(list).getAllByLabelText('Failed')).toHaveLength(1);
  });
});
