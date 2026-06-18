#!/usr/bin/env node
// stdio MCP launcher: relays JSON-RPC between an MCP client (stdio) and a
// running Insomnium app's loopback HTTP+SSE server, located via its discovery
// file. Enable "MCP automation server" in Insomnium, then run `npx insomnium-mcp`.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

interface Discovery {
  port: number;
  token: string;
  url?: string;
}

// Mirrors packages/insomnia/src/main/mcp/discovery.ts — keep in sync.
function discoveryFilePath(): string {
  return process.env.INSOMNIUM_MCP_DISCOVERY_FILE
    || path.join(os.homedir(), '.insomnium', 'mcp.json');
}

function die(message: string): never {
  process.stderr.write(`insomnium-mcp: ${message}\n`);
  process.exit(1);
}

async function readDiscovery(): Promise<Discovery> {
  const file = discoveryFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return die(
      `could not read ${file}. Is Insomnium running with the MCP automation `
      + 'server enabled? (Settings → MCP automation)',
    );
  }
  let parsed: Discovery;
  try {
    parsed = JSON.parse(raw) as Discovery;
  } catch {
    return die(`discovery file ${file} is not valid JSON`);
  }
  if (!parsed.port || !parsed.token) {
    return die(`discovery file ${file} is missing port/token`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const disc = await readDiscovery();
  const endpoint = new URL(disc.url ?? `http://127.0.0.1:${disc.port}/sse`);
  const authHeader = `Bearer ${disc.token}`;

  // requestInit.headers is applied to both the SSE stream and POST messages.
  const upstream = new SSEClientTransport(endpoint, {
    requestInit: { headers: { Authorization: authHeader } },
  });
  const downstream = new StdioServerTransport();

  let closing = false;
  const shutdown = (code: number): void => {
    if (closing) {
      return;
    }
    closing = true;
    void upstream.close().catch(() => { /* noop */ });
    void downstream.close().catch(() => { /* noop */ });
    process.exit(code);
  };

  // Relay each side's messages verbatim; the initialize handshake passes through.
  upstream.onmessage = (msg: JSONRPCMessage) => {
    void downstream.send(msg).catch(err => {
      process.stderr.write(`insomnium-mcp: stdout write failed: ${String(err)}\n`);
    });
  };
  downstream.onmessage = (msg: JSONRPCMessage) => {
    void upstream.send(msg).catch(err => {
      process.stderr.write(`insomnium-mcp: upstream send failed: ${String(err)}\n`);
    });
  };

  upstream.onclose = () => shutdown(0);
  downstream.onclose = () => shutdown(0);
  upstream.onerror = err => process.stderr.write(`insomnium-mcp: upstream error: ${String(err)}\n`);
  downstream.onerror = err => process.stderr.write(`insomnium-mcp: stdio error: ${String(err)}\n`);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  try {
    // Connect SSE; resolves once the app sends the message endpoint.
    await upstream.start();
  } catch (err) {
    return die(
      `failed to connect to Insomnium at ${endpoint.href}: ${String(err)}. `
      + 'Make sure the app is running and the MCP server is enabled.',
    );
  }
  // Read stdin only once upstream is ready.
  await downstream.start();
}

main().catch(err => die(String(err)));
