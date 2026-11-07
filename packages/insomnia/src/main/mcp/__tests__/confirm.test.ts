import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron, { type MessageBoxOptions, type MessageBoxReturnValue } from 'electron';

import { confirmMcpCommand } from '../confirm-command';
import { confirmGitAction } from '../confirm-git';
import { confirmTestRun } from '../confirm-test-run';

const window = { flashFrame: jest.fn() };
const showMessageBox = jest.fn<(window: unknown, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>();
(electron.dialog as any).showMessageBox = showMessageBox;

// a box the user answers with a button, or that closes as cancelled when its
// signal aborts, as Electron's does
let answer: (response: number) => void;
const box = (closesOnAbort = true) => showMessageBox.mockImplementation((_window, options) => new Promise(resolve => {
  answer = response => resolve({ response, checkboxChecked: false });
  if (closesOnAbort) {
    options.signal?.addEventListener('abort', () => answer(options.cancelId!));
  }
}));
const shown = () => showMessageBox.mock.calls[0][1];

const confirms = {
  confirmTestRun: (signal?: AbortSignal) => confirmTestRun({ suite: 'Smoke', workspace: 'Shop', tests: ['is up'] }, signal),
  confirmGitAction: (signal?: AbortSignal) => confirmGitAction({ action: 'push', workspace: 'Shop', branch: 'main', remote: 'https://example.com/shop.git', details: [] }, signal),
  confirmMcpCommand: (signal?: AbortSignal) => confirmMcpCommand({ request: 'Local', command: 'npx', args: ['server'] }, signal),
};

describe.each(Object.entries(confirms))('%s', (_name, confirm) => {
  beforeEach(() => {
    showMessageBox.mockReset();
    window.flashFrame.mockReset();
    jest.spyOn(electron.BrowserWindow, 'getFocusedWindow').mockReturnValue(window as any);
  });

  it('is a yes when the user picks the first button', async () => {
    box();
    const asked = confirm(new AbortController().signal);
    answer(0);
    expect(await asked).toBe(true);
    expect(showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ defaultId: 1, cancelId: 1 }));
    expect(window.flashFrame.mock.calls).toEqual([[true], [false]]);
  });

  it('is a no when the user cancels', async () => {
    box();
    const asked = confirm(new AbortController().signal);
    answer(1);
    expect(await asked).toBe(false);
  });

  it('closes the box as a no when the request is aborted before an answer', async () => {
    box();
    const request = new AbortController();
    const asked = confirm(request.signal);
    expect(shown().signal).toBe(request.signal);
    request.abort();
    expect(await asked).toBe(false);
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
  });

  it('ignores an answer after the abort, from a box that stayed open', async () => {
    box(false);
    const request = new AbortController();
    const asked = confirm(request.signal);
    request.abort();
    expect(await asked).toBe(false);
    answer(0);
    expect(await asked).toBe(false);
  });

  it('opens no box for a request already aborted', async () => {
    const request = new AbortController();
    request.abort();
    expect(await confirm(request.signal)).toBe(false);
    expect(showMessageBox).not.toHaveBeenCalled();
  });
});
