import { askInApp } from './ask-in-app';
import type { GitActionRequest } from './tools/git';

const VERBS = { commit: 'Commit', pull: 'Pull', push: 'Push' };

// Asks the user, in the app, before an MCP client commits, pulls or pushes:
// each changes their history or someone else's. Declining is the default, and
// so is a request the client gives up on.
export async function confirmGitAction({ action, workspace, branch, remote, details }: GitActionRequest, signal?: AbortSignal): Promise<boolean> {
  const verb = VERBS[action];
  return askInApp({
    type: 'question',
    title: `${verb} with Git?`,
    message: `An MCP client wants to ${action} "${workspace}" on ${branch || 'its branch'}${action === 'commit' ? '' : remote ? ` (${remote})` : ''}.`,
    detail: details.join('\n'),
    buttons: [verb, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }, signal);
}
