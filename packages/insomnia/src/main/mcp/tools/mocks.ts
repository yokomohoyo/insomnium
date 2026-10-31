import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loadMockRoutes, type MockLogEntry, mockPathOf } from '../../../mock/mock-routes';
import * as models from '../../../models';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// what the app's mock servers (main/mock-servers.ts) offer the tools
export interface MockControls {
  start: (workspaceId: string, port: number) => Promise<{ url: string; port: number }>;
  stop: (workspaceId: string) => Promise<void>;
  status: (workspaceId: string) => { url: string; port: number } | null;
  recent: (workspaceId: string) => MockLogEntry[];
}

// what a collection's mock answers: each request with examples, by method and path
const routesOf = async (workspaceId: string) => {
  const workspace = await models.workspace.getById(workspaceId);
  if (!workspace) {
    return null;
  }
  return (await loadMockRoutes(workspace)).map(({ request, examples }) => ({
    method: request.method,
    path: mockPathOf(request.url),
    request: request.name,
    examples: examples.map(example => `${example.name} (${example.statusCode})`),
  }));
};

// The app's only: the headless server has its own `mock` command
export function registerMockTools(server: McpServer, mocks: MockControls) {
  server.tool(
    'start_mock_server',
    "Start a local mock server for a collection, as its Mock Server dialog does: it answers each of the collection's HTTP requests with its saved response examples (create_response_example), matched by method and path, on 127.0.0.1. Restarts it if it's running. port 0 picks a free one. Returns its URL and the routes it answers.",
    { workspaceId: z.string(), port: z.number().int().min(0).max(65535).default(0) },
    async ({ workspaceId, port }) => {
      const routes = await routesOf(workspaceId);
      if (!routes) {
        return text({ error: 'workspace not found' }, true);
      }
      let status;
      try {
        status = await mocks.start(workspaceId, port);
      } catch (err) {
        return text({ error: `the mock server could not start: ${(err as Error).message}` }, true);
      }
      return text({
        ...status,
        routes,
        ...(routes.length ? {} : { note: 'no request in this collection has a response example yet, so every path answers 404; add some with create_response_example' }),
      });
    },
  );

  server.tool(
    'stop_mock_server',
    "Stop a collection's mock server.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const running = mocks.status(workspaceId);
      await mocks.stop(workspaceId);
      return text({ ok: true, wasRunning: !!running });
    },
  );

  server.tool(
    'get_mock_server',
    "Whether a collection's mock server is running, its URL, the routes it answers, and the latest requests it answered (up to 50): each with its method, path, status, and the request and example that answered.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const routes = await routesOf(workspaceId);
      if (!routes) {
        return text({ error: 'workspace not found' }, true);
      }
      const status = mocks.status(workspaceId);
      return text({ running: !!status, ...status, routes, recentRequests: status ? mocks.recent(workspaceId) : [] });
    },
  );
}
