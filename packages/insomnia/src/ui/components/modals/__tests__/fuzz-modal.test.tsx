import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import type { FuzzPoint } from '../../../../common/fuzz';
import { fuzzCsv } from '../../../../network/fuzz-report';
import type { FuzzAttemptResult, FuzzRunSummary, listFuzzPoints, runFuzz } from '../../../../network/fuzz-run';
import { FuzzModal } from '../fuzz-modal';

jest.mock('react-aria', () => ({
  ...(jest.requireActual('react-aria') as object),
  OverlayContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const writeFile = jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined as never);
const showSaveDialog = jest.fn<() => Promise<{ canceled: boolean; filePath?: string }>>();
(window as any).dialog = { showSaveDialog };

const point = (id: string, kind: FuzzPoint['kind'], label: string, suggested = true): FuzzPoint => ({ id, kind, label, original: 'x', suggested });
const POINTS = [point('query:p0', 'query', 'Query: status'), point('path:1', 'path', 'Path: 1st part (orders)', false), point('json-new', 'json-new', 'Body: a new field')];

const attempt = (patch: Partial<FuzzAttemptResult>): FuzzAttemptResult =>
  ({ index: 1, pointId: 'query:p0', position: 'Query: status', payload: "'", statusCode: 200, bytes: 31, elapsed: 12, flags: [], notable: false, snippet: '{"orders":[]}', ...patch });
const SUMMARY: FuzzRunSummary = {
  baseline: { statusCode: 200, bytes: 31, elapsed: 10 },
  requests: 3,
  notable: 1,
  stopped: false,
  attempts: [
    attempt({ index: 1, statusCode: 500, snippet: 'You have an error in your SQL syntax', notable: true, flags: [{ id: 'server-error', label: 'The server failed (500)', notable: true }, { id: 'error-details', label: 'The answer shows a database error', notable: true }] }),
    attempt({ index: 2, payload: '"' }),
  ],
};

const open = (method = 'GET', run: typeof runFuzz = jest.fn<typeof runFuzz>(async (_id, options) => {
  SUMMARY.attempts.forEach(sent => options.onAttempt?.(sent));
  return SUMMARY;
})) => {
  const list = jest.fn<typeof listFuzzPoints>(async () => ({ points: POINTS, method, url: 'https://shop.example.com/orders?status=open' }));
  const view = render(<FuzzModal request={{ _id: 'req_1', name: 'Orders', method }} list={list} run={run} />);
  return { ...view, run };
};

describe('<FuzzModal />', () => {
  beforeEach(() => {
    writeFile.mockClear();
    showSaveDialog.mockReset();
  });

  it('lists where payloads can go, with the likely places ticked, and says how many requests that is', async () => {
    const { findByLabelText, getByLabelText, getByTestId, getByRole, run } = open();

    expect((await findByLabelText('Query: status') as HTMLInputElement).checked).toBe(true);
    expect(getByLabelText('Positions').children).toHaveLength(3);
    expect((getByLabelText('Path: 1st part (orders)') as HTMLInputElement).checked).toBe(false);
    // SQL (10) and odd values (14) in the query, the fields (15) as a new field
    expect(getByTestId('fuzz-plan').textContent).toBe('39 attempts, and the request once as it is.');
    expect(getByRole('button', { name: 'Send 40 Requests' })).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });

  it('counts again as positions, lists and your own payloads change', async () => {
    const { findByLabelText, getByLabelText, getByTestId } = open();
    await findByLabelText('Query: status');

    fireEvent.click(getByLabelText('Body: a new field'));
    expect(getByTestId('fuzz-plan').textContent).toContain('24 attempts');
    fireEvent.click(getByLabelText(/^Odd values/));
    expect(getByTestId('fuzz-plan').textContent).toContain('10 attempts');
    fireEvent.change(getByLabelText('Your own, one a line (name=value adds a field to a JSON body)'), { target: { value: 'admin\nrole=owner' } });
    // (the field has nowhere to go with the new field unticked)
    expect(getByTestId('fuzz-plan').textContent).toContain('11 attempts');
  });

  it('spreads the payloads over the positions the way chosen, and counts that', async () => {
    const { findByLabelText, findByRole, getByLabelText, getByTestId, run } = open();
    await findByLabelText('Query: status');
    fireEvent.click(getByLabelText('Path: 1st part (orders)'));
    // one at a time: 24 in the query, 24 in the path, 15 as a new field
    expect(getByTestId('fuzz-plan').textContent).toContain('63 attempts');

    fireEvent.change(getByLabelText('Positions:'), { target: { value: 'together' } });
    // each payload once, in every position it fits
    expect(getByTestId('fuzz-plan').textContent).toContain('39 attempts');

    fireEvent.change(getByLabelText('Positions:'), { target: { value: 'combinations' } });
    // 24 x 24 x 15, of which a run makes the first 2000
    expect(getByTestId('fuzz-plan').textContent).toBe('2,000 attempts, and the request once as it is. A run sends 2000 at most.');

    fireEvent.click(await findByRole('button', { name: 'Send 2001 Requests' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('req_1', expect.objectContaining({ mode: 'combinations', pointIds: ['query:p0', 'json-new', 'path:1'] })));
  });

  it('sends what was chosen, and shows what stood out first', async () => {
    const { findByRole, findByTestId, getByLabelText, queryByTestId, run } = open();

    fireEvent.click(await findByRole('button', { name: 'Send 40 Requests' }));

    const summary = await findByTestId('fuzz-summary');
    await waitFor(() => expect(summary.textContent).toBe('1 attempt is worth a look · 3 requests sent · the request itself got 200'));
    expect(run).toHaveBeenCalledWith('req_1', expect.objectContaining({ pointIds: ['query:p0', 'json-new'], delay: 0, signal: expect.any(AbortSignal) }));
    expect((run as jest.Mock).mock.calls[0][1]).toMatchObject({ payloads: expect.arrayContaining([{ value: "'" }]) });
    // only the one that stood out, until asked for the rest
    expect(queryByTestId('fuzz-attempt-2')).toBeNull();
    expect((await findByTestId('fuzz-attempt-1')).textContent).toContain('The server failed (500); The answer shows a database error');
    fireEvent.click(getByLabelText('Only those worth a look'));
    expect(await findByTestId('fuzz-attempt-2')).toBeTruthy();
  });

  it("shows the start of an attempt's answer when its row is opened", async () => {
    const { findByRole, findByTestId, findByLabelText } = open();
    fireEvent.click(await findByRole('button', { name: 'Send 40 Requests' }));

    fireEvent.click(await findByTestId('fuzz-attempt-1'));

    expect((await findByLabelText('The start of the answer to attempt 1')).textContent).toBe('You have an error in your SQL syntax');
  });

  it("won't send a request that changes things until it's said that it may", async () => {
    const { findByRole, getByRole, getByLabelText, run } = open('POST');
    const send = await findByRole('button', { name: 'Send 40 Requests' }) as HTMLButtonElement;

    expect(send.disabled).toBe(true);
    fireEvent.click(getByLabelText(/^This is a POST: every attempt may change data on the server/));
    expect((getByRole('button', { name: 'Send 40 Requests' }) as HTMLButtonElement).disabled).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('stops the run from its Stop button', async () => {
    let signal: AbortSignal | undefined;
    const run = jest.fn<typeof runFuzz>((_id, options) => new Promise(() => {
      signal = options.signal;
    }));
    const { findByRole } = open('GET', run);

    fireEvent.click(await findByRole('button', { name: 'Send 40 Requests' }));
    fireEvent.click(await findByRole('button', { name: 'Stop' }));

    expect(signal?.aborted).toBe(true);
  });

  it('saves the attempts as CSV', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/Orders-fuzz.csv' });
    const { findByRole, findByTestId } = open();
    fireEvent.click(await findByRole('button', { name: 'Send 40 Requests' }));
    await findByTestId('fuzz-attempt-1');

    fireEvent.click(await findByRole('button', { name: 'Save CSV' }));

    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Orders-fuzz.csv' }));
    expect(writeFile.mock.calls[0][1]).toBe(fuzzCsv(SUMMARY));
  });
});

describe('fuzzCsv()', () => {
  it('has a row for each attempt, with quotes doubled', () => {
    expect(fuzzCsv(SUMMARY).split('\r\n')).toEqual([
      '"attempt","position","payload","status","bytes","ms","worth a look","what it showed","error"',
      '"1","Query: status","\'","500","31","12","yes","The server failed (500); The answer shows a database error",""',
      '"2","Query: status","""","200","31","12","","",""',
      '',
    ]);
  });
});
