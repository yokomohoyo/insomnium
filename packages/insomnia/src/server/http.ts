import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createListener, type TlsFiles } from './tls';

interface Options {
  host: string;
  port: number;
  token: string;
  buildServer: () => McpServer;
  // HTTPS from these files, when set
  tls?: TlsFiles;
}

/**
 * MCP over Streamable HTTP at POST /mcp, stateless (each request gets its own
 * server, so any replica can answer) and with JSON responses, behind a bearer
 * token. GET /health is open, for container health checks.
 */
export const startHttpServer = ({ host, port, token, buildServer, tls }: Options) => new Promise<http.Server>((resolve, reject) => {
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (req: http.IncomingMessage) => {
    const given = Buffer.from(req.headers.authorization || '');
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const server = createListener(async (req, res) => {
    const reply = (status: number, body: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const { pathname } = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && pathname === '/health') {
        return reply(200, { ok: true });
      }
      if (pathname !== '/mcp') {
        return reply(404, { error: 'not found' });
      }
      if (!authorized(req)) {
        return reply(401, { error: 'unauthorized' });
      }
      if (req.method !== 'POST') {
        return reply(405, { error: 'this server is stateless: POST JSON-RPC to /mcp' });
      }
      const mcp = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close().catch(() => {});
        mcp.close().catch(() => {});
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('[server] request failed:', err);
      if (!res.headersSent) {
        reply(500, { error: 'internal error' });
      } else {
        res.end();
      }
    }
  }, tls);

  server.once('error', reject);
  server.listen(port, host, () => {
    server.off('error', reject);
    resolve(server);
  });
});
