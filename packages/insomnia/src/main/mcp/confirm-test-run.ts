import { askInApp } from './ask-in-app';
import type { TestRunRequest } from './tools/test-run';

const LISTED = 10;

// Asks the user, in the app, before an MCP client runs unit tests: their code
// runs with the app's full access. Declining is the default, and so is a
// request the client gives up on.
export async function confirmTestRun({ suite, workspace, tests }: TestRunRequest, signal?: AbortSignal): Promise<boolean> {
  const listed = tests.slice(0, LISTED).map(name => `• ${name}`);
  if (tests.length > LISTED) {
    listed.push(`and ${tests.length - LISTED} more`);
  }
  return askInApp({
    type: 'warning',
    title: 'Run unit tests?',
    message: `An MCP client wants to run ${tests.length === 1 ? 'the 1 unit test' : `the ${tests.length} unit tests`} in "${suite}"${workspace ? ` (${workspace})` : ''}.`,
    detail: [
      "Unit tests are JavaScript that runs with this app's full access to your computer. Run them only if you know where they came from: a client can write tests as well as run them.",
      '',
      ...listed,
    ].join('\n'),
    buttons: ['Run the Tests', "Don't Run"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }, signal);
}
