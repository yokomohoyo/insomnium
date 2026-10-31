import { BrowserWindow, dialog } from 'electron';

import type { GitActionRequest } from './tools/git';

const VERBS = { commit: 'Commit', pull: 'Pull', push: 'Push' };

// Asks the user, in the app, before an MCP client commits, pulls or pushes:
// each changes their history or someone else's. Declining is the default.
export async function confirmGitAction({ action, workspace, branch, remote, details }: GitActionRequest): Promise<boolean> {
  const verb = VERBS[action];
  const buttons = [verb, 'Cancel'];
  const options = {
    type: 'question' as const,
    title: `${verb} with Git?`,
    message: `An MCP client wants to ${action} "${workspace}" on ${branch || 'its branch'}${action === 'commit' ? '' : remote ? ` (${remote})` : ''}.`,
    detail: details.join('\n'),
    buttons,
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  window?.flashFrame(true);
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  window?.flashFrame(false);
  return response === 0;
}
