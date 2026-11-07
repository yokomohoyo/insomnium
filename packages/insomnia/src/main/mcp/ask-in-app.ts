import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron';

// Asks the user with a message box whose first button is yes. The box follows
// the MCP request that opened it: when the client cancels or goes away, it
// closes and counts as a no, and an answer after that is ignored, so nothing
// runs with nobody waiting for the result.
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
    const shown = (window ? dialog.showMessageBox(window, { ...options, signal }) : dialog.showMessageBox({ ...options, signal }))
      .then(({ response }) => response === 0);
    const allowed = await Promise.race([shown, aborted]);
    return allowed && !signal?.aborted;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    window?.flashFrame(false);
  }
}
