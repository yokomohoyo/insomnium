import { askInApp } from './ask-in-app';

// Asks the user, in the app, before an MCP client runs an MCP request's
// command (a stdio server): it runs with their permissions, and a collection's
// command could be anything. Declining is the default, as the app's own ask
// is, and so is a request the client gives up on.
export async function confirmMcpCommand({ request, command, args }: { request: string; command: string; args: string[] }, signal?: AbortSignal): Promise<boolean> {
  return askInApp({
    type: 'warning',
    title: 'Run the MCP server?',
    message: `An MCP client wants to connect "${request}", which runs this command on your computer, with your permissions:`,
    detail: `${[command, ...args].join(' ')}\n\nRun it only if you trust it.`,
    buttons: ['Run', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }, signal);
}
