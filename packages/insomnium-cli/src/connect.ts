// Connects to a running Insomnium app's loopback MCP server as an MCP client.
// Same discovery/auth path as the insomnium-mcp launcher — keep in sync with
// packages/insomnium-mcp/src/index.ts.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export class CliError extends Error {}

export interface Discovery {
  port: number;
  token: string;
  url?: string;
}

export function discoveryFilePath(): string {
  return process.env.INSOMNIUM_MCP_DISCOVERY_FILE
    || path.join(os.homedir(), '.insomnium', 'mcp.json');
}

// The discovery file is written by the local app, but it's still untrusted
// input: validate it targets loopback so a tampered file can't redirect the
// authenticated connection (bearer token) to a remote host.
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  // 127.0.0.0/8
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export async function readDiscovery(): Promise<Discovery> {
  const file = discoveryFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new CliError(
      `could not read ${file}. Is Insomnium running with the MCP automation `
      + 'server enabled? (Settings → MCP automation)',
    );
  }
  let parsed: Discovery;
  try {
    parsed = JSON.parse(raw) as Discovery;
  } catch {
    throw new CliError(`discovery file ${file} is not valid JSON`);
  }
  if (!parsed.port || !parsed.token) {
    throw new CliError(`discovery file ${file} is missing port/token`);
  }
  if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
    throw new CliError(`discovery file ${file} has an invalid port: ${parsed.port}`);
  }
  if (parsed.url !== undefined) {
    let host: string;
    try {
      host = new URL(parsed.url).hostname;
    } catch {
      throw new CliError(`discovery file ${file} has an invalid url: ${parsed.url}`);
    }
    if (!isLoopbackHost(host)) {
      throw new CliError(`discovery file ${file} url must target loopback, got host: ${host}`);
    }
  }
  return parsed;
}

export async function connect(): Promise<Client> {
  const disc = await readDiscovery();
  const endpoint = new URL(disc.url ?? `http://127.0.0.1:${disc.port}/sse`);
  const transport = new SSEClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${disc.token}` } },
  });
  const client = new Client({ name: 'insomnium-cli', version: '1.0.0' });
  try {
    await client.connect(transport);
  } catch (err) {
    throw new CliError(
      `failed to connect to Insomnium at ${endpoint.href}: ${String(err)}. `
      + 'Make sure the app is running and the MCP server is enabled.',
    );
  }
  return client;
}

// Connect, run fn, always close so the process can exit.
export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => { /* noop */ });
  }
}
