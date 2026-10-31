import { BrowserWindow, dialog } from 'electron';

// Asks the user, in the app, before an MCP client runs an MCP request's
// command (a stdio server): it runs with their permissions, and a collection's
// command could be anything. Declining is the default, as the app's own ask is.
export async function confirmMcpCommand({ request, command, args }: { request: string; command: string; args: string[] }): Promise<boolean> {
  const buttons = ['Run', 'Cancel'];
  const options = {
    type: 'warning' as const,
    title: 'Run the MCP server?',
    message: `An MCP client wants to connect "${request}", which runs this command on your computer, with your permissions:`,
    detail: `${[command, ...args].join(' ')}\n\nRun it only if you trust it.`,
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
