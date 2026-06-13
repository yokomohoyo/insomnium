// MCP automation server. Loopback HTTP+SSE, Bearer-auth-gated.

import { randomBytes } from 'node:crypto';
import http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import * as models from '../../models';
import { registerTools } from './tools';

interface RunningServer {
  http: http.Server;
  port: number;
  transports: Map<string, SSEServerTransport>;
}

let current: RunningServer | null = null;

export function getRunningMcpServer(): { port: number } | null {
  return current ? { port: current.port } : null;
}

export async function ensureMcpToken(): Promise<string> {
  const settings = await models.settings.getOrCreate();
  if (settings.mcpToken && settings.mcpToken.length >= 32) {
    return settings.mcpToken;
  }
  const token = randomBytes(24).toString('base64url');
  await models.settings.update(settings, { mcpToken: token });
  return token;
}

export async function startMcpServer(): Promise<{ port: number }> {
  if (current) {
    return { port: current.port };
  }
  const settings = await models.settings.getOrCreate();
  const token = await ensureMcpToken();
  const requestedPort = Math.max(0, Math.floor(settings.mcpPort || 0));

  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    // The awaits below (connect/handlePostMessage) can reject; an uncaught
    // rejection here would crash the Electron main process.
    try {
      const url = req.url || '/';

      // Unauthenticated liveness probe.
      if (req.method === 'GET' && url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (!checkAuth(req, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (req.method === 'GET' && url === '/sse') {
        const mcpServer = buildMcpServer();
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);
        res.on('close', () => {
          transports.delete(transport.sessionId);
          mcpServer.close().catch(() => { /* noop */ });
        });
        await mcpServer.connect(transport);
        return;
      }

      if (req.method === 'POST' && url.startsWith('/message')) {
        const sessionId = new URL(url, 'http://localhost').searchParams.get('sessionId');
        const transport = sessionId ? transports.get(sessionId) : null;
        if (!transport) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unknown sessionId' }));
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      console.error('[mcp] request handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        try {
          res.end();
        } catch { /* noop */ }
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : requestedPort;
  current = { http: httpServer, port, transports };
  console.log(`[mcp] listening on http://127.0.0.1:${port}`);
  return { port };
}

export async function stopMcpServer(): Promise<void> {
  if (!current) return;
  const server = current;
  current = null;
  for (const t of server.transports.values()) {
    try {
      await t.close();
    } catch { /* noop */ }
  }
  await new Promise<void>(resolve => server.http.close(() => resolve()));
  console.log('[mcp] stopped');
}

function checkAuth(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length).trim();
  if (provided.length !== token.length) return false;
  let diff = 0; // constant-time compare
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'insomnium',
    version: '1.0.0',
  });
  registerTools(server);
  return server;
}
