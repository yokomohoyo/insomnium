// Connects to a running Insomnium app's loopback MCP server as an MCP client.
// Discovery and auth are the insomnium-mcp launcher's: ./discovery.ts is copied
// from packages/insomnium-mcp/src/discovery.ts at build time.

import { createRequire } from 'node:module';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import { authHeaders, endpointUrl, readDiscovery } from './discovery.js';

// From the published package.json (dist/ sits next to it), so it can't drift.
export const VERSION: string = createRequire(import.meta.url)('../package.json').version;

export class CliError extends Error {}

export async function connect(): Promise<Client> {
  const disc = await readDiscovery();
  const endpoint = new URL(endpointUrl(disc));
  const transport = new SSEClientTransport(endpoint, {
    requestInit: { headers: authHeaders(disc) },
  });
  const client = new Client({ name: 'insomnium-cli', version: VERSION });
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
