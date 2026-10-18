import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';

// A stateless MCP server over streamable HTTP, for the MCP request: a tool,
// a prompt and a resource
export const mcpRouter = express.Router();

mcpRouter.post('/', async (request, response) => {
  const mcp = new McpServer({ name: 'smoke-pets', version: '1.0.0' }, { instructions: 'Pets for the smoke tests' });
  mcp.tool('add', 'Adds two numbers', { a: z.number(), b: z.number() }, async ({ a, b }) => ({ content: [{ type: 'text', text: `sum: ${a + b}` }] }));
  mcp.prompt('greet', 'Greets a pet', { name: z.string() }, ({ name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Hello ${name}` } }] }));
  mcp.resource('readme', 'docs://readme', async uri => ({ contents: [{ uri: uri.href, text: 'Smoke pets' }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  response.on('close', () => {
    transport.close();
    mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(request, response, request.body);
});

// no server-sent stream, and no sessions to end
mcpRouter.all('/', (_request, response) => {
  response.status(405).end();
});
