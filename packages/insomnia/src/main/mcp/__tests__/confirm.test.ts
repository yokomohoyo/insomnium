import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron, { type MessageBoxOptions, type MessageBoxReturnValue } from 'electron';

import { ANSWER_CHANNEL, ASK_CHANNEL, askInApp, CANCEL_CHANNEL, type InAppQuestion, SHOWN_CHANNEL, SHOWN_WITHIN_MS } from '../ask-in-app';
import { confirmMcpCommand } from '../confirm-command';
import { confirmGitAction } from '../confirm-git';
import { confirmSecurityTests } from '../confirm-security-tests';
import { confirmTestRun } from '../confirm-test-run';

const showMessageBox = jest.fn<(window: unknown, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>();
(electron.dialog as any).showMessageBox = showMessageBox;

// the app's window, with a page that takes questions (or one still loading, that can't)
const webContents = { send: jest.fn(), isDestroyed: () => false, isLoading: jest.fn(() => false) };
const window = { flashFrame: jest.fn(), isDestroyed: () => false, webContents };
// what the page says back, as the main process hears it (it starts listening
// with its first question)
const heard: Record<string, (event: { sender: unknown }, ...args: unknown[]) => void> = {};
(electron.ipcMain as any).on = (channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => void) => {
  heard[channel] = listener;
};
const fromPage = (channel: string, ...args: unknown[]) => heard[channel]({ sender: webContents }, ...args);
const asked = (): InAppQuestion => webContents.send.mock.calls.find(([channel]) => channel === ASK_CHANNEL)?.[1] as InAppQuestion;

// the system's box, which the user answers with a button, or that closes as
// cancelled when its signal aborts, as Electron's does
let answerBox: (response: number) => void;
const box = (closesOnAbort = true) => showMessageBox.mockImplementation((_window, options) => new Promise(resolve => {
  answerBox = response => resolve({ response, checkboxChecked: false });
  if (closesOnAbort) {
    options.signal?.addEventListener('abort', () => answerBox(options.cancelId!));
  }
}));

const confirms = {
  confirmTestRun: (signal?: AbortSignal) => confirmTestRun({ suite: 'Smoke', workspace: 'Shop', tests: ['is up'] }, signal),
  confirmGitAction: (signal?: AbortSignal) => confirmGitAction({ action: 'push', workspace: 'Shop', branch: 'main', remote: 'https://example.com/shop.git', details: [] }, signal),
  confirmMcpCommand: (signal?: AbortSignal) => confirmMcpCommand({ request: 'Local', command: 'npx', args: ['server'] }, signal),
  confirmSecurityTests: (signal?: AbortSignal) => confirmSecurityTests({ request: 'Orders', method: 'GET', url: 'https://shop.example.com/orders', workspace: 'Shop', requests: 25 }, signal),
  confirmSecurityChecks: (signal?: AbortSignal) => confirmSecurityTests({ request: 'Orders', count: 12, workspace: 'Shop', requests: 200 }, signal),
};

beforeEach(() => {
  showMessageBox.mockReset();
  window.flashFrame.mockReset();
  webContents.send.mockReset();
  webContents.isLoading.mockReturnValue(false);
  jest.spyOn(electron.BrowserWindow, 'getFocusedWindow').mockReturnValue(window as any);
});

describe.each(Object.entries(confirms))('%s, in the app\'s own dialog', (_name, confirm) => {
  it('asks in the window, with no as the second button, and is a yes only when the page says true', async () => {
    const answer = confirm(new AbortController().signal);

    const question = asked();
    expect(question).toMatchObject({ id: expect.any(String), title: expect.any(String), message: expect.any(String), yes: expect.any(String), no: expect.any(String) });
    expect(question.yes).not.toBe(question.no);
    fromPage(SHOWN_CHANNEL, question.id);
    fromPage(ANSWER_CHANNEL, question.id, true);

    expect(await answer).toBe(true);
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(window.flashFrame.mock.calls).toEqual([[true], [false]]);
  });

  it('is a no when the page says so, or says anything but true', async () => {
    for (const said of [false, 'true', 1, undefined]) {
      webContents.send.mockReset();
      const answer = confirm(new AbortController().signal);
      fromPage(SHOWN_CHANNEL, asked().id);
      fromPage(ANSWER_CHANNEL, asked().id, said);
      expect(await answer).toBe(false);
    }
  });

  it('takes the page down as a no when the request is aborted, and ignores an answer after that', async () => {
    const request = new AbortController();
    const answer = confirm(request.signal);
    const { id } = asked();
    fromPage(SHOWN_CHANNEL, id);

    request.abort();

    expect(await answer).toBe(false);
    expect(webContents.send).toHaveBeenLastCalledWith(CANCEL_CHANNEL, id);
    fromPage(ANSWER_CHANNEL, id, true);
    expect(await answer).toBe(false);
  });

  it('asks nothing for a request already aborted', async () => {
    const request = new AbortController();
    request.abort();

    expect(await confirm(request.signal)).toBe(false);
    expect(webContents.send).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
  });
});

describe('askInApp()', () => {
  const options: MessageBoxOptions = { type: 'warning', title: 'Run?', message: 'A client wants to run it.', detail: 'npx server', buttons: ['Run', 'Cancel'], defaultId: 1, cancelId: 1 };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends the page the question as it was put', async () => {
    const answer = askInApp(options, new AbortController().signal);

    expect(asked()).toEqual({ id: expect.any(String), type: 'warning', title: 'Run?', message: 'A client wants to run it.', detail: 'npx server', yes: 'Run', no: 'Cancel' });
    fromPage(ANSWER_CHANNEL, asked().id, false);
    await answer;
  });

  it('takes an answer only for the question asked, from the window it was asked in', async () => {
    const answer = askInApp(options, new AbortController().signal);
    const { id } = asked();
    let settled = false;
    answer.then(() => {
      settled = true;
    });

    fromPage(ANSWER_CHANNEL, 'another-question', true);
    heard[ANSWER_CHANNEL]({ sender: { other: true } }, id, true);
    await Promise.resolve();
    expect(settled).toBe(false);

    fromPage(ANSWER_CHANNEL, id, false);
    expect(await answer).toBe(false);
  });

  it("asks with the system's box when the page doesn't show the question in time", async () => {
    jest.useFakeTimers();
    box();
    const answer = askInApp(options, new AbortController().signal);
    const { id } = asked();

    jest.advanceTimersByTime(SHOWN_WITHIN_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(webContents.send).toHaveBeenLastCalledWith(CANCEL_CHANNEL, id);
    expect(showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ defaultId: 1, cancelId: 1 }));
    // (and the page's late answer to the question it was told to drop is nobody's)
    fromPage(ANSWER_CHANNEL, id, true);
    answerBox(1);
    expect(await answer).toBe(false);
  });

  it('waits as long as it takes once the page has shown it', async () => {
    jest.useFakeTimers();
    const answer = askInApp(options, new AbortController().signal);
    fromPage(SHOWN_CHANNEL, asked().id);

    jest.advanceTimersByTime(SHOWN_WITHIN_MS * 20);
    await Promise.resolve();

    expect(showMessageBox).not.toHaveBeenCalled();
    fromPage(ANSWER_CHANNEL, asked().id, true);
    expect(await answer).toBe(true);
  });
});

describe.each(Object.entries(confirms))("%s, in the system's box", (_name, confirm) => {
  // a window whose page can't take the question yet
  beforeEach(() => {
    webContents.isLoading.mockReturnValue(true);
  });
  const shown = () => showMessageBox.mock.calls[0][1];

  it('is a yes when the user picks the first button', async () => {
    box();
    const answer = confirm(new AbortController().signal);
    await Promise.resolve();
    answerBox(0);
    expect(await answer).toBe(true);
    expect(webContents.send).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ defaultId: 1, cancelId: 1 }));
    expect(window.flashFrame.mock.calls).toEqual([[true], [false]]);
  });

  it('is a no when the user cancels', async () => {
    box();
    const answer = confirm(new AbortController().signal);
    await Promise.resolve();
    answerBox(1);
    expect(await answer).toBe(false);
  });

  it('closes the box as a no when the request is aborted before an answer', async () => {
    box();
    const request = new AbortController();
    const answer = confirm(request.signal);
    await Promise.resolve();
    expect(shown().signal).toBe(request.signal);
    request.abort();
    expect(await answer).toBe(false);
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
  });

  it('ignores an answer after the abort, from a box that stayed open', async () => {
    box(false);
    const request = new AbortController();
    const answer = confirm(request.signal);
    await Promise.resolve();
    request.abort();
    expect(await answer).toBe(false);
    answerBox(0);
    expect(await answer).toBe(false);
  });
});
