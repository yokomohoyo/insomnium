import { BrowserWindow, type WebContents } from 'electron';

import type { MockLogEntry } from '../mock/mock-routes';
import { type MockServer, startMockServer } from '../mock/mock-server';

// The mock servers the app runs, one per collection at most, started from the
// Mock Server dialog or by an MCP client
const running = new Map<string, MockServer>();
// each server's latest requests, for a client to read back
const recent = new Map<string, MockLogEntry[]>();
const RECENT = 50;

export interface MockServerStatus {
  url: string;
  port: number;
}

// the request log goes to the window that started the server, or to every
// window when a client did (the dialog shows its own collection's)
export async function startCollectionMock(workspaceId: string, port: number, sender?: WebContents): Promise<MockServerStatus> {
  await stopCollectionMock(workspaceId);
  recent.set(workspaceId, []);
  const server = await startMockServer({
    workspaceIds: [workspaceId],
    port,
    onRequest: (entry: MockLogEntry) => {
      const log = recent.get(workspaceId);
      if (log) {
        log.push(entry);
        log.splice(0, Math.max(0, log.length - RECENT));
      }
      const targets = sender ? [sender] : BrowserWindow.getAllWindows().map(window => window.webContents);
      for (const target of targets) {
        if (!target.isDestroyed()) {
          target.send('mockServer.request', workspaceId, entry);
        }
      }
    },
  });
  running.set(workspaceId, server);
  return { url: server.url, port: server.port };
}

export async function stopCollectionMock(workspaceId: string) {
  const server = running.get(workspaceId);
  running.delete(workspaceId);
  await server?.close();
}

export const collectionMockStatus = (workspaceId: string): MockServerStatus | null => {
  const server = running.get(workspaceId);
  return server ? { url: server.url, port: server.port } : null;
};

export const recentMockRequests = (workspaceId: string): MockLogEntry[] => [...recent.get(workspaceId) || []];
