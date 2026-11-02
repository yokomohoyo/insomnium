// What the MCP server should do for the settings as they are now: start, stop,
// or start again on a new port or token, which drops the clients that had the
// old one
export type McpServerAction = 'none' | 'start' | 'stop' | 'restart';

export function mcpServerAction(
  settings: { mcpEnabled: boolean; mcpPort: number; mcpToken: string },
  running: { port: number; token: string } | null,
): McpServerAction {
  if (!settings.mcpEnabled) {
    return running ? 'stop' : 'none';
  }
  if (!running) {
    return 'start';
  }
  const portChanged = settings.mcpPort > 0 && running.port !== settings.mcpPort;
  // a blank or short token is replaced as the server starts
  const tokenChanged = settings.mcpToken.length >= 32 && settings.mcpToken !== running.token;
  return portChanged || tokenChanged ? 'restart' : 'none';
}
