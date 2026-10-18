import type { WebContents } from 'electron';

import type { MockLogEntry } from '../mock/mock-routes';
import { type MockServer, startMockServer } from '../mock/mock-server';

// The mock servers the app runs, one per collection at most
const running = new Map<string, MockServer>();

export interface MockServerStatus {
  url: string;
  port: number;
}

export async function startCollectionMock(workspaceId: string, port: number, sender: WebContents): Promise<MockServerStatus> {
  await stopCollectionMock(workspaceId);
  const server = await startMockServer({
    workspaceIds: [workspaceId],
    port,
    onRequest: (entry: MockLogEntry) => {
      if (!sender.isDestroyed()) {
        sender.send('mockServer.request', workspaceId, entry);
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
