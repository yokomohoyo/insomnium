import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import type { RunnableRequest } from '../../../../network/runner';
import type { runSecurityChecks, SecurityRunItem, SecurityRunSummary } from '../../../../network/security-run';
import { SecurityRunModal } from '../security-run-modal';

const navigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...(jest.requireActual('react-router-dom') as object),
  useNavigate: () => navigate,
  useParams: () => ({ organizationId: 'org_1', projectId: 'proj_1', workspaceId: 'wrk_1' }),
  useRouteLoaderData: () => ({
    activeEnvironment: { _id: 'env_base', name: 'Base Environment' },
    subEnvironments: [{ _id: 'env_ben', name: 'Ben' }],
    activeWorkspaceMeta: { securityIgnoredRules: ['nosniff-missing'] },
  }),
}));
jest.mock('react-aria', () => ({
  ...(jest.requireActual('react-aria') as object),
  OverlayContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const writeFile = jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined as never);
const showSaveDialog = jest.fn<() => Promise<{ canceled: boolean; filePath?: string }>>();
(window as any).dialog = { showSaveDialog };

const request = (id: string, method: string): RunnableRequest => ({ folders: [], request: { _id: id, type: 'Request', name: id, method, url: 'https://shop.example.com/orders', headers: [] } as any });
const REQUESTS = [request('List', 'GET'), request('Create', 'POST'), request('Head', 'HEAD')];

const item = (patch: Partial<SecurityRunItem>): SecurityRunItem => ({ requestId: 'List', name: 'List', folders: ['Orders'], method: 'GET', url: 'https://shop.example.com/orders', outcome: 'tested', findings: [], checks: [], requests: 9, ...patch });
const SUMMARY: SecurityRunSummary = {
  requests: 18,
  stopped: false,
  findings: { high: 1, medium: 0, low: 1, info: 0 },
  items: [
    item({
      findings: [
        { id: 'no-credentials', severity: 'high', owasp: 'API2:2023 Broken Authentication', title: 'It answers the same without credentials', detail: 'Anyone can read this.' },
        { id: 'rate-limit', severity: 'low', owasp: 'API4:2023 Unrestricted Resource Consumption', title: 'No sign of a rate limit', detail: 'Nothing says there is one.' },
      ],
      checks: [{ id: 'no-credentials', title: 'Without its credentials', outcome: 'found', note: 'It answered 200.' }],
    }),
    item({ requestId: 'Create', name: 'Create', method: 'POST', outcome: 'skipped', requests: 0, note: "A POST isn't sent again, and it has no response to look at: send it first." }),
  ],
};

const open = (run: typeof runSecurityChecks = jest.fn<typeof runSecurityChecks>(async (_requests, options) => {
  SUMMARY.items.forEach(done => options?.onItem?.(done));
  return SUMMARY;
})) => {
  const list = jest.fn(async () => REQUESTS);
  const onHide = jest.fn();
  const view = render(<SecurityRunModal parentId="wrk_1" name="Shop" run={run} list={list as any} onHide={onHide} />);
  return { ...view, run, onHide };
};

describe('<SecurityRunModal />', () => {
  beforeEach(() => {
    navigate.mockReset();
    writeFile.mockClear();
    showSaveDialog.mockReset();
  });

  it('says how many requests it may send before anything is sent, on the button that starts it', async () => {
    const { findByTestId, getByRole, run } = open();

    expect((await findByTestId('security-run-plan')).textContent).toBe('3 requests: up to 52 requests will be sent.');
    expect(getByRole('button', { name: 'Run the Checks (up to 52 requests)' })).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the checks with the collection\'s ignored rules, and shows each request with what was found', async () => {
    const { findByRole, findByTestId, getByTestId, getByLabelText, run } = open();

    fireEvent.click(await findByRole('button', { name: 'Run the Checks (up to 52 requests)' }));

    const summary = await findByTestId('security-run-summary');
    await waitFor(() => expect(summary.textContent).toBe('1 high, 1 low · 18 requests sent'));
    expect(run).toHaveBeenCalledWith(REQUESTS, expect.objectContaining({ ignored: ['nosniff-missing'], otherEnvironmentId: null, signal: expect.any(AbortSignal) }));
    expect(getByLabelText('Security check results').children).toHaveLength(2);
    expect(getByTestId('security-run-item-List').textContent).toContain('2 findings');
    expect(getByLabelText('Findings for List').textContent).toContain('It answers the same without credentials');
    expect(getByLabelText('Tests run on List').textContent).toContain('Without its credentials');
    expect(getByTestId('security-run-item-Create').textContent).toContain('not checked');
    expect(getByTestId('security-run-item-Create').textContent).toContain("A POST isn't sent again");
  });

  it('gives the results the room once a run has started, and offers to run again', async () => {
    const { findByRole, findByTestId, getByTestId, queryByTestId, queryByLabelText } = open();
    await findByTestId('security-run-plan');
    expect(getByTestId('security-run-intro').textContent).toContain("Run it only against an API you're allowed to test.");

    fireEvent.click(await findByRole('button', { name: 'Run the Checks (up to 52 requests)' }));
    await waitFor(async () => expect((await findByTestId('security-run-summary')).textContent).toContain('requests sent'));

    expect(queryByTestId('security-run-intro')).toBeNull();
    expect(queryByTestId('security-run-plan')).toBeNull();
    expect(queryByLabelText('As another user:')).toBeNull();
    // (the button still says how many it may send)
    expect(await findByRole('button', { name: 'Run Again (up to 52 requests)' })).toBeTruthy();
  });

  it('tests as another user when an environment is chosen', async () => {
    const { findByRole, findByTestId, getByLabelText, run } = open();
    await findByTestId('security-run-plan');

    fireEvent.change(getByLabelText('As another user:'), { target: { value: 'env_ben' } });
    fireEvent.click(await findByRole('button', { name: 'Run the Checks (up to 52 requests)' }));
    await waitFor(async () => expect((await findByTestId('security-run-summary')).textContent).toContain('requests sent'));

    expect(run).toHaveBeenCalledWith(REQUESTS, expect.objectContaining({ otherEnvironmentId: 'env_ben' }));
  });

  it('tests with less privilege when that environment is chosen', async () => {
    const { findByRole, findByTestId, getByLabelText, run } = open();
    await findByTestId('security-run-plan');

    fireEvent.change(getByLabelText('With less privilege:'), { target: { value: 'env_ben' } });
    fireEvent.click(await findByRole('button', { name: 'Run the Checks (up to 52 requests)' }));
    await waitFor(async () => expect((await findByTestId('security-run-summary')).textContent).toContain('requests sent'));

    expect(run).toHaveBeenCalledWith(REQUESTS, expect.objectContaining({ lowerEnvironmentId: 'env_ben', otherEnvironmentId: null }));
  });

  it('stops the run from its Stop button, and when it is closed', async () => {
    let signal: AbortSignal | undefined;
    const run = jest.fn<typeof runSecurityChecks>((_requests, options) => new Promise(() => {
      signal = options?.signal;
    }));
    const { findByRole } = open(run);

    fireEvent.click(await findByRole('button', { name: 'Run the Checks (up to 52 requests)' }));
    fireEvent.click(await findByRole('button', { name: 'Stop' }));

    expect(signal?.aborted).toBe(true);
  });

  it('saves the report in the format chosen', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/Shop-security.md' });
    const { findByRole, findByTestId } = open();
    fireEvent.click(await findByRole('button', { name: 'Run the Checks (up to 52 requests)' }));
    await waitFor(async () => expect((await findByTestId('security-run-summary')).textContent).toContain('requests sent'));

    fireEvent.click(await findByRole('button', { name: 'Save Markdown' }));

    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Shop-security.md' }));
    expect(writeFile.mock.calls[0][0]).toBe('/tmp/Shop-security.md');
    expect(writeFile.mock.calls[0][1]).toContain('# Security checks: Shop');
  });

  it('opens a request from its name', async () => {
    const { findByRole, findByTestId, getByRole } = open();
    fireEvent.click(await findByRole('button', { name: 'Run the Checks (up to 52 requests)' }));
    await waitFor(async () => expect((await findByTestId('security-run-summary')).textContent).toContain('requests sent'));

    fireEvent.click(getByRole('button', { name: 'Create' }));

    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('/request/Create'));
  });
});
