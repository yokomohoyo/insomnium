import { askInApp } from './ask-in-app';
import type { SecurityTestRequest } from './tools/security-tests';

// Asks the user, in the app, before an MCP client runs a request's security
// tests: they send requests made to find what an API lets through, which is
// only for an API the user may test. Declining is the default, and so is a
// request the client gives up on.
export async function confirmSecurityTests({ request, method, url, count, workspace, requests }: SecurityTestRequest, signal?: AbortSignal): Promise<boolean> {
  const all = count !== undefined;
  return askInApp({
    type: 'warning',
    title: 'Run security tests?',
    message: `An MCP client wants to run the security tests on ${all ? 'every request in ' : ''}"${request}"${workspace ? ` (${workspace})` : ''}.`,
    detail: [
      all ? `${count} ${count === 1 ? 'request' : 'requests'}: each GET and HEAD is tested, the others are never sent.` : `${method} ${url}`,
      '',
      `${all ? 'Up to' : 'The request is sent again up to'} ${requests} ${all ? 'requests are sent' : 'times'}, changed a little each time: without its credentials, with a quote in a parameter, many times in a row. Allow it only for an API you're allowed to test.`,
    ].join('\n'),
    buttons: ['Run the Tests', "Don't Run"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }, signal);
}
