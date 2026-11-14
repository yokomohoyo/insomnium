// Finds a running Insomnium app's loopback MCP server through the discovery
// file the app writes (packages/insomnia/src/main/mcp/discovery.ts).
//
// The one copy of this code: insomnium-cli's build copies this file into its
// own src/ (packages/insomnium-cli/scripts/sync-discovery.mjs), so each
// published package carries it without depending on the other. Keep it free of
// imports beyond node: built-ins.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Discovery {
  port: number;
  token: string;
  url?: string;
}

// A discovery file that is missing or unusable; the message is for the user.
export class DiscoveryError extends Error {}

export function discoveryFilePath(): string {
  return process.env.INSOMNIUM_MCP_DISCOVERY_FILE
    || path.join(os.homedir(), '.insomnium', 'mcp.json');
}

// `hostname` as URL.hostname gives it: IPv6 keeps its brackets.
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  // 127.0.0.0/8
  return h === 'localhost' || h === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export async function readDiscovery(): Promise<Discovery> {
  const file = discoveryFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new DiscoveryError(
      `could not read ${file}. Is Insomnium running with the MCP automation `
      + 'server enabled? (Settings → MCP automation)',
    );
  }
  let parsed: Discovery;
  try {
    parsed = JSON.parse(raw) as Discovery;
  } catch {
    throw new DiscoveryError(`discovery file ${file} is not valid JSON`);
  }
  if (!parsed.port || !parsed.token) {
    throw new DiscoveryError(`discovery file ${file} is missing port/token`);
  }
  if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
    throw new DiscoveryError(`discovery file ${file} has an invalid port: ${parsed.port}`);
  }
  // The file is written by the local app, but it's still untrusted input: the
  // token goes to that URL, so only to this computer, whatever the file says
  if (parsed.url !== undefined) {
    let host: string;
    try {
      host = new URL(parsed.url).hostname;
    } catch {
      throw new DiscoveryError(`discovery file ${file} has an invalid url: ${parsed.url}`);
    }
    if (!isLoopbackHost(host)) {
      throw new DiscoveryError(`discovery file ${file} url must target loopback, got host: ${host}`);
    }
  }
  return parsed;
}

// The app's SSE endpoint, as written in the file or built from the port.
export function endpointUrl(disc: Discovery): string {
  return disc.url ?? `http://127.0.0.1:${disc.port}/sse`;
}

export function authHeaders(disc: Discovery): Record<string, string> {
  return { Authorization: `Bearer ${disc.token}` };
}
