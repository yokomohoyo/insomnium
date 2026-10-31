// An MCP request's connection, shared by its request pane (which connects)
// and its response pane (which explores and calls what the server offers).
import { useEffect, useSyncExternalStore } from 'react';

import type { McpServerSummary } from '../../../main/network/mcp-client';

export type McpConnection =
  | { status: 'disconnected'; error?: string }
  | { status: 'connecting' }
  | { status: 'connected'; server: McpServerSummary };

const DISCONNECTED: McpConnection = { status: 'disconnected' };

// what went wrong in the main process, without Electron's "Error invoking
// remote method 'mcpClient:connect': Error: " before it
export const mcpErrorMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const connections = new Map<string, McpConnection>();
const listeners = new Set<() => void>();

export const getMcpConnection = (requestId: string) => connections.get(requestId) || DISCONNECTED;

export const setMcpConnection = (requestId: string, connection: McpConnection) => {
  connections.set(requestId, connection);
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useMcpConnection(requestId: string) {
  const connection = useSyncExternalStore(subscribe, () => getMcpConnection(requestId));
  // the server went away (it exited, or closed the connection)
  useEffect(() => window.main.on(`mcpClient.${requestId}.closed`, () => {
    if (getMcpConnection(requestId).status === 'connected') {
      setMcpConnection(requestId, { status: 'disconnected', error: 'The server closed the connection' });
    }
  }), [requestId]);
  return connection;
}
