import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import type { SecurityTestResult } from '../../../../common/security-tests';
import type { SecurityTestOptions } from '../../../../network/security-tests';
import { securityTestFindings, SecurityTestsPanel } from '../security-tests-panel';

const RESULT: SecurityTestResult = {
  requests: 9,
  findings: [{ id: 'no-credentials', severity: 'high', owasp: 'API2:2023 Broken Authentication', title: 'It answers the same without credentials', detail: 'Anyone can read this.' }],
  checks: [
    { id: 'baseline', title: 'The request as it is', outcome: 'passed', note: 'It answered 200.' },
    { id: 'no-credentials', title: 'Without its credentials', outcome: 'found', note: 'It answered 200. The answer was the same as with credentials.' },
    { id: 'other-user', title: 'As another user', outcome: 'skipped', note: 'No other environment was chosen to send it as.' },
  ],
};

type RunTests = (requestId: string, options: SecurityTestOptions) => Promise<SecurityTestResult>;
const ENVIRONMENTS = [{ _id: 'env_ben', name: 'Ben' }];
let nextId = 0;
// (a request of its own for each test: a request's last run is remembered)
const panel = (props: Partial<React.ComponentProps<typeof SecurityTestsPanel>> = {}) => {
  const run = jest.fn<RunTests>().mockResolvedValue(RESULT);
  const confirm = jest.fn<(requests: number) => Promise<boolean>>().mockResolvedValue(true);
  const request = { _id: `req_${++nextId}`, method: 'GET' };
  const view = render(<SecurityTestsPanel request={request} environments={ENVIRONMENTS} run={run} confirm={confirm} {...props} />);
  return { ...view, run, confirm, request };
};

describe('<SecurityTestsPanel />', () => {
  it('asks first, and sends nothing on a no', async () => {
    const confirm = jest.fn<(requests: number) => Promise<boolean>>().mockResolvedValue(false);
    const { getByRole, run } = panel({ confirm });

    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(26));
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the tests, then shows what they found and what each one saw', async () => {
    const { getByRole, getByTestId, getByLabelText, findByLabelText, run, request, container } = panel();

    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));

    expect((await findByLabelText('Security tests run')).children).toHaveLength(3);
    expect(run).toHaveBeenCalledWith(request._id, { otherEnvironmentId: null, lowerEnvironmentId: null, signal: expect.any(AbortSignal) });
    expect(getByLabelText('Security test findings').textContent).toContain('It answers the same without credentials');
    expect(getByTestId('security-check-no-credentials').textContent).toContain('Found');
    expect(getByTestId('security-check-other-user').textContent).toContain('Not run');
    expect(container.textContent).toContain('9 requests were sent.');
  });

  it('drops what was found once the request is edited', async () => {
    const { getByRole, findByLabelText, queryByLabelText, rerender, run, confirm, request } = panel();
    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));
    await findByLabelText('Security tests run');

    rerender(<SecurityTestsPanel request={{ ...request, modified: 2 }} environments={ENVIRONMENTS} run={run} confirm={confirm} />);

    expect(queryByLabelText('Security tests run')).toBeNull();
  });

  it('says when a run has finished, for the count on the tab, and leaves out what the collection ignores', async () => {
    const onResult = jest.fn();
    const onIgnore = jest.fn();
    const { getByRole, findByLabelText, queryByLabelText, rerender, run, confirm, request } = panel({ onResult, onIgnore });
    expect(securityTestFindings(request)).toEqual([]);

    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));
    await findByLabelText('Security tests run');

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(securityTestFindings(request)).toEqual(RESULT.findings);
    fireEvent.click(getByRole('button', { name: 'Ignore It answers the same without credentials' }));
    expect(onIgnore).toHaveBeenCalledWith('no-credentials');

    rerender(<SecurityTestsPanel request={request} environments={ENVIRONMENTS} run={run} confirm={confirm} ignored={['no-credentials']} />);
    expect(queryByLabelText('Security test findings')).toBeNull();
    // (the test itself is still listed)
    expect((await findByLabelText('Security tests run')).children).toHaveLength(3);
  });

  it('sends it as another user when an environment is chosen', async () => {
    const { getByRole, getByLabelText, findByLabelText, run, request } = panel();

    fireEvent.change(getByLabelText('As another user:'), { target: { value: 'env_ben' } });
    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));
    await findByLabelText('Security tests run');

    expect(run).toHaveBeenCalledWith(request._id, expect.objectContaining({ otherEnvironmentId: 'env_ben' }));
  });

  it('sends it with less privilege when that environment is chosen', async () => {
    const { getByRole, getByLabelText, findByLabelText, run, request } = panel();

    fireEvent.change(getByLabelText('With less privilege:'), { target: { value: 'env_ben' } });
    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));
    await findByLabelText('Security tests run');

    expect(run).toHaveBeenCalledWith(request._id, expect.objectContaining({ lowerEnvironmentId: 'env_ben', otherEnvironmentId: null }));
  });

  it('says when the request is marked as restricted, and what to choose for it', () => {
    const { getByTestId, getByLabelText, queryByTestId, rerender, request, run, confirm } = panel({ restricted: true });

    expect(getByTestId('security-restricted-note').textContent).toContain('Choose an environment under With less privilege');
    fireEvent.change(getByLabelText('With less privilege:'), { target: { value: 'env_ben' } });
    expect(getByTestId('security-restricted-note').textContent).toContain('it will be tried with less privilege');

    rerender(<SecurityTestsPanel request={request} environments={ENVIRONMENTS} run={run} confirm={confirm} />);
    expect(queryByTestId('security-restricted-note')).toBeNull();
  });

  it('says to add an environment when a restricted request has none to be tried with', () => {
    const { getByTestId } = panel({ restricted: true, environments: [] });

    expect(getByTestId('security-restricted-note').textContent).toContain('Add an environment');
  });

  it('stops a run when asked to', async () => {
    let signal: AbortSignal | undefined;
    const run = jest.fn<RunTests>((_id, options) => new Promise<SecurityTestResult>(() => {
      signal = options.signal;
    }));
    const { getByRole, findByRole } = panel({ run });

    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));
    fireEvent.click(await findByRole('button', { name: 'Stop' }));

    expect(signal?.aborted).toBe(true);
  });

  it('says why the tests could not run', async () => {
    const run = jest.fn<RunTests>().mockRejectedValue(new Error('The pre-request script failed: boom'));
    const { getByRole, findByText } = panel({ run });

    fireEvent.click(getByRole('button', { name: 'Run Security Tests' }));

    expect(await findByText('The tests could not run: The pre-request script failed: boom')).toBeTruthy();
  });

  it("doesn't offer to test a request that changes things", () => {
    const { queryByRole, container } = panel({ request: { _id: 'req_post', method: 'POST' } });

    expect(queryByRole('button', { name: 'Run Security Tests' })).toBeNull();
    expect(container.textContent).toContain('Only a GET or HEAD request is tested: a POST would change things once more for every test.');
  });
});
