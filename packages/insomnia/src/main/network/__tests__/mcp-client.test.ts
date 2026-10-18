/**
 * @jest-environment node
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { mcpCall, mcpConnect, mcpDisconnect, mcpIsConnected } from '../mcp-client';

// a stateless MCP server over streamable HTTP, with one of each
let server: http.Server;
let url = '';
const seenKeys: (string | undefined)[] = [];

beforeAll(async () => {
  server = http.createServer(async (request, response) => {
    seenKeys.push(request.headers['x-key'] as string | undefined);
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const mcp = new McpServer({ name: 'pets', version: '1.2.3' }, { instructions: 'Ask about pets' });
    mcp.tool('add', 'Adds two numbers', { a: z.number(), b: z.number() }, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
    mcp.tool('fail', 'Always fails', {}, async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }));
    mcp.prompt('greet', 'Greets someone', { name: z.string() }, ({ name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Hello ${name}` } }] }));
    mcp.resource('readme', 'docs://readme', async uri => ({ contents: [{ uri: uri.href, text: 'The pets API' }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on('close', () => {
      transport.close();
      mcp.close();
    });
    await mcp.connect(transport);
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    await transport.handleRequest(request, response, body ? JSON.parse(body) : undefined);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await mcpDisconnect({ requestId: 'mcp-req_1' });
  await new Promise(resolve => server.close(resolve));
});

describe('the MCP client', () => {
  it("connects over streamable HTTP, with the request's headers, and lists what the server offers", async () => {
    const summary = await mcpConnect({ requestId: 'mcp-req_1', transport: 'http', url, headers: { 'X-Key': 'secret' } });

    expect(summary).toMatchObject({ name: 'pets', version: '1.2.3', instructions: 'Ask about pets', transport: 'streamable-http' });
    expect(summary.tools.map(tool => tool.name)).toEqual(['add', 'fail']);
    expect(summary.tools[0].inputSchema).toMatchObject({ type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } });
    expect(summary.prompts.map(prompt => prompt.name)).toEqual(['greet']);
    expect(summary.resources).toEqual([expect.objectContaining({ name: 'readme', uri: 'docs://readme' })]);
    expect(seenKeys.every(key => key === 'secret')).toBe(true);
    expect(mcpIsConnected({ requestId: 'mcp-req_1' })).toBe(true);
  });

  it('calls a tool, gets a prompt, and reads a resource', async () => {
    expect(await mcpCall({ requestId: 'mcp-req_1', kind: 'tool', name: 'add', args: { a: 2, b: 3 } })).toMatchObject({ content: [{ type: 'text', text: '5' }] });
    expect(await mcpCall({ requestId: 'mcp-req_1', kind: 'tool', name: 'fail', args: {} })).toMatchObject({ isError: true });
    expect(await mcpCall({ requestId: 'mcp-req_1', kind: 'prompt', name: 'greet', args: { name: 'Kim' } })).toMatchObject({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hello Kim' } }],
    });
    expect(await mcpCall({ requestId: 'mcp-req_1', kind: 'resource', uri: 'docs://readme' })).toMatchObject({ contents: [{ text: 'The pets API' }] });
  });

  it('is not connected after disconnecting', async () => {
    await mcpDisconnect({ requestId: 'mcp-req_1' });

    expect(mcpIsConnected({ requestId: 'mcp-req_1' })).toBe(false);
    await expect(mcpCall({ requestId: 'mcp-req_1', kind: 'tool', name: 'add', args: {} })).rejects.toThrow('Not connected');
  });

  it('stops connecting when disconnected meanwhile, and stays disconnected', async () => {
    const connecting = mcpConnect({ requestId: 'mcp-req_3', transport: 'http', url });
    await new Promise(resolve => setImmediate(resolve));
    await mcpDisconnect({ requestId: 'mcp-req_3' });

    await expect(connecting).rejects.toThrow('Stopped connecting');
    expect(mcpIsConnected({ requestId: 'mcp-req_3' })).toBe(false);
  });

  it('needs an http(s) URL, or a command', async () => {
    await expect(mcpConnect({ requestId: 'mcp-req_2', transport: 'http', url: 'ftp://example.com' })).rejects.toThrow('http or https');
    await expect(mcpConnect({ requestId: 'mcp-req_2', transport: 'http', url: 'not a url' })).rejects.toThrow("MCP server's http:// or https:// URL");
    await expect(mcpConnect({ requestId: 'mcp-req_2', transport: 'stdio', command: ' ' })).rejects.toThrow('Enter the command');
  });
});
