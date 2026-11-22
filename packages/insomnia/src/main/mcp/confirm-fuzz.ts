import { askInApp } from './ask-in-app';
import type { FuzzRequest } from './tools/fuzz';

const some = (items: string[], most = 6) => items.length > most ? `${items.slice(0, most).join(', ')} and ${items.length - most} more` : items.join(', ');

// Asks the user, in the app, before an MCP client fuzzes a request: it sends
// the request many times with payloads made to break things, which is only
// for an API the user may test, and a request that changes data changes it
// every time. Declining is the default, and so is a request the client gives
// up on.
const SPREAD = {
  one: 'once for each payload in each position',
  together: 'once for each payload, put in every position at once',
  combinations: 'once for each combination of payloads over the positions',
};

export async function confirmFuzz({ request, method, url, workspace, requests, positions, lists, mode, changesData }: FuzzRequest, signal?: AbortSignal): Promise<boolean> {
  return askInApp({
    type: 'warning',
    title: 'Fuzz this request?',
    message: `An MCP client wants to fuzz "${request}"${workspace ? ` (${workspace})` : ''}.`,
    detail: [
      `${method} ${url}`,
      '',
      `${requests} requests are sent: the request as it is, then ${SPREAD[mode]}.`,
      `Positions: ${some(positions)}`,
      `Payloads: ${lists.length ? some(lists) : 'none'}`,
      '',
      ...(changesData ? [`A ${method} changes data: every attempt the server accepts makes or changes something. Allow it only if that can be put right.`, ''] : []),
      "Allow it only for an API you're allowed to test.",
    ].join('\n'),
    buttons: ['Fuzz It', "Don't Fuzz"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }, signal);
}
