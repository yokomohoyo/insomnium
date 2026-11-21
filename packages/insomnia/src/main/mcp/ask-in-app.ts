import { randomUUID } from 'node:crypto';

import { BrowserWindow, dialog, ipcMain, type MessageBoxOptions, type WebContents } from 'electron';

// What the app's window is sent to ask (ui/components/modals/mcp-confirm-modal.tsx)
export interface InAppQuestion {
  id: string;
  type: 'warning' | 'question';
  title: string;
  message: string;
  detail: string;
  // the buttons: yes does it, no is the default
  yes: string;
  no: string;
}

export const ASK_CHANNEL = 'mcp.confirm';
export const SHOWN_CHANNEL = 'mcp.confirm.shown';
export const ANSWER_CHANNEL = 'mcp.confirm.answer';
export const CANCEL_CHANNEL = 'mcp.confirm.cancel';
// how long the window has to say it is showing the question, before the
// system's own box asks instead
export const SHOWN_WITHIN_MS = 3000;

interface Pending {
  // the window that was asked: nothing else's answer counts
  sender: WebContents;
  shown: () => void;
  answer: (allowed: boolean) => void;
}
const pending = new Map<string, Pending>();

let listening = false;
const listen = () => {
  if (listening) {
    return;
  }
  listening = true;
  const from = (event: { sender: WebContents }, id: unknown) => {
    const question = typeof id === 'string' ? pending.get(id) : undefined;
    return question && question.sender === event.sender ? question : undefined;
  };
  ipcMain.on(SHOWN_CHANNEL, (event, id: unknown) => from(event, id)?.shown());
  // only a plain true is a yes
  ipcMain.on(ANSWER_CHANNEL, (event, id: unknown, allowed: unknown) => from(event, id)?.answer(allowed === true));
};

// the system's message box: for when there is no window to ask in, or the
// window doesn't take the question
const askWithBox = (window: BrowserWindow | undefined, options: MessageBoxOptions, signal?: AbortSignal) =>
  (window ? dialog.showMessageBox(window, { ...options, signal }) : dialog.showMessageBox({ ...options, signal }))
    .then(({ response }) => response === 0);

// in the app's window, as one of its own dialogs. Resolves 'unasked' when the
// window didn't show it in time.
const askInWindow = (window: BrowserWindow, options: MessageBoxOptions, signal?: AbortSignal) => new Promise<boolean | 'unasked'>(resolve => {
  listen();
  const id = randomUUID();
  const sender = window.webContents;
  const [yes = 'Yes', no = 'Cancel'] = options.buttons || [];
  const done = (result: boolean | 'unasked') => {
    clearTimeout(unshown);
    pending.delete(id);
    signal?.removeEventListener('abort', onAbort);
    resolve(result);
  };
  const cancel = () => {
    if (!sender.isDestroyed()) {
      sender.send(CANCEL_CHANNEL, id);
    }
  };
  const onAbort = () => {
    cancel();
    done(false);
  };
  const unshown = setTimeout(() => {
    cancel();
    done('unasked');
  }, SHOWN_WITHIN_MS);
  pending.set(id, { sender, shown: () => clearTimeout(unshown), answer: done });
  signal?.addEventListener('abort', onAbort, { once: true });
  const question: InAppQuestion = {
    id,
    type: options.type === 'warning' ? 'warning' : 'question',
    title: options.title || '',
    message: options.message,
    detail: options.detail || '',
    yes,
    no,
  };
  sender.send(ASK_CHANNEL, question);
});

// Asks the user, in the app's own dialog, with a yes and a no that is the
// default. The question follows the MCP request that opened it: when the
// client cancels or goes away, it closes and counts as a no, and an answer
// after that is ignored, so nothing runs with nobody waiting for the result.
// Without a window that shows it, the system's message box asks instead.
export async function askInApp(options: MessageBoxOptions, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return false;
  }
  const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  window?.flashFrame(true);
  let onAbort = () => {};
  // the box closes itself on abort, but not everywhere (macOS without a window)
  const aborted = new Promise<false>(resolve => {
    onAbort = () => resolve(false);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const ready = window && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isLoading();
    let allowed = ready ? await askInWindow(window, options, signal) : 'unasked';
    if (allowed === 'unasked') {
      if (signal?.aborted) {
        return false;
      }
      allowed = await Promise.race([askWithBox(window, options, signal), aborted]);
    }
    return allowed === true && !signal?.aborted;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    window?.flashFrame(false);
  }
}
