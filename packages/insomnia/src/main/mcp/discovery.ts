// Advertises the loopback MCP server's live port + token (mode 0600, holds the
// bearer token) so the external `insomnium-mcp` launcher can find it. Removed
// on shutdown. Keep path/shape in sync with packages/insomnium-mcp/src/index.ts.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface McpDiscovery {
  port: number;
  token: string;
  url: string;
  pid: number;
  transport: 'sse';
  updatedAt: string;
}

export function getDiscoveryFilePath(): string {
  return process.env.INSOMNIUM_MCP_DISCOVERY_FILE
    || path.join(os.homedir(), '.insomnium', 'mcp.json');
}

export async function writeDiscoveryFile(info: { port: number; token: string }): Promise<void> {
  const file = getDiscoveryFilePath();
  const data: McpDiscovery = {
    port: info.port,
    token: info.token,
    url: `http://127.0.0.1:${info.port}/sse`,
    pid: process.pid,
    transport: 'sse',
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function removeDiscoveryFile(): Promise<void> {
  try {
    await fs.unlink(getDiscoveryFilePath());
  } catch {
    /* already gone — nothing to clean up */
  }
}
