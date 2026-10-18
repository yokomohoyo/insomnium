import type { ISpectralDiagnostic } from '@stoplight/spectral-core';
import { app, BrowserWindow, ipcMain, IpcRendererEvent, shell } from 'electron';
import fs from 'fs';

import { credentialStorageStatus } from '../../common/database';
import { runInSandbox, SandboxResult } from '../../scripting/sandbox';
import type { ToastNotification } from '../../ui/components/toast';
import { authorizeInSystemBrowser } from '../authorize-in-system-browser';
import { authorizeUserInWindow } from '../authorizeUserInWindow';
import { credentialStorageNotices } from '../credential-keys';
import { insomniaFetch } from '../insomniaFetch';
import { collectionMockStatus, type MockServerStatus, startCollectionMock, stopCollectionMock } from '../mock-servers';
import installPlugin from '../install-plugin';
import { axiosRequest } from '../network/axios-request';
import { checkForNewRelease } from '../release-check';
import { getSnapshotsPath, listSnapshots, restoreSnapshotOnRestart, Snapshot, takeSnapshot } from '../snapshots';
import { CurlBridgeAPI } from '../network/curl';
import { cancelCurlRequest, curlRequest } from '../network/libcurl-promise';
import type { FolderSyncBridgeAPI } from '../folder-sync';
import type { McpClientBridgeAPI } from '../network/mcp-client';
import { WebSocketBridgeAPI } from '../network/websocket';
import { lintSpec } from '../spectral-lint';
import { gRPCBridgeAPI } from './grpc';

export interface MainBridgeAPI {
  loginStateChange: () => void;
  openInBrowser: (url: string) => void;
  restart: () => void;
  halfSecondAfterAppStart: () => void;
  spectralRun: (options: { contents: string; rulesetPath: string }) => Promise<ISpectralDiagnostic[]>;
  // scripting/sandbox.ts
  runScript: (options: { code: string; input: object; timeoutMs: number }) => Promise<SandboxResult<unknown>>;
  authorizeUserInWindow: typeof authorizeUserInWindow;
  authorizeInSystemBrowser: (options: { url: string; redirectUrl: string }) => ReturnType<typeof authorizeInSystemBrowser>;
  setMenuBarVisibility: (visible: boolean) => void;
  installPlugin: typeof installPlugin;
  writeFile: (options: { path: string; content: string }) => Promise<string>;
  cancelCurlRequest: typeof cancelCurlRequest;
  curlRequest: typeof curlRequest;
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => () => void;
  webSocket: WebSocketBridgeAPI;
  mcpClient: McpClientBridgeAPI;
  folderSync: FolderSyncBridgeAPI;
  grpc: gRPCBridgeAPI;
  curl: CurlBridgeAPI;
  trackSegmentEvent: (options: { event: string; properties?: Record<string, unknown> }) => void;
  trackPageView: (options: { name: string }) => void;
  axiosRequest: typeof axiosRequest;
  insomniaFetch: typeof insomniaFetch;
  showContextMenu: (options: { key: string }) => void;
  webUtilsGetPathForFile: (file: File) => string;
  getMcpStatus: () => Promise<{ running: boolean; port: number | null }>;
  checkForNewRelease: () => Promise<ToastNotification | null>;
  credentialStorageNotices: () => Promise<ToastNotification[]>;
  listSnapshots: () => Promise<Snapshot[]>;
  takeSnapshot: () => Promise<string>;
  // relaunches the app, which restores the snapshot before opening the data
  restoreSnapshot: (name: string) => Promise<void>;
  showSnapshotsFolder: () => Promise<void>;
  // a collection's local mock server (mock/mock-server.ts); it reports each
  // request it answers on 'mockServer.request'
  mockServer: {
    start: (options: { workspaceId: string; port: number }) => Promise<MockServerStatus>;
    stop: (workspaceId: string) => Promise<void>;
    status: (workspaceId: string) => Promise<MockServerStatus | null>;
  };
}
export function registerMainHandlers() {
  ipcMain.handle('insomniaFetch', async (_, options: Parameters<typeof insomniaFetch>[0]) => {
    return insomniaFetch(options);
  });
  ipcMain.handle('axiosRequest', async (_, options: Parameters<typeof axiosRequest>[0]) => {
    return axiosRequest(options);
  });
  ipcMain.on('loginStateChange', async () => {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('loggedIn');
    });
  });
  ipcMain.handle('authorizeUserInWindow', (_, options: Parameters<typeof authorizeUserInWindow>[0]) => {
    const { url, urlSuccessRegex, urlFailureRegex, sessionId } = options;
    return authorizeUserInWindow({ url, urlSuccessRegex, urlFailureRegex, sessionId });
  });

  ipcMain.handle('authorizeInSystemBrowser', (_, { url, redirectUrl }: { url: string; redirectUrl: string }) =>
    authorizeInSystemBrowser({ url, redirectUrl }));

  ipcMain.handle('writeFile', async (_, options: { path: string; content: string }) => {
    try {
      await fs.promises.writeFile(options.path, options.content);
      return options.path;
    } catch (err) {
      throw new Error(err);
    }
  });

  ipcMain.handle('mockServer.start', (event, { workspaceId, port }: { workspaceId: string; port: number }) => startCollectionMock(workspaceId, port, event.sender));
  ipcMain.handle('mockServer.stop', (_, workspaceId: string) => stopCollectionMock(workspaceId));
  ipcMain.handle('mockServer.status', (_, workspaceId: string) => collectionMockStatus(workspaceId));
  ipcMain.handle('runScript', (_, { code, input, timeoutMs }: { code: string; input: object; timeoutMs: number }) => runInSandbox(code, input, { timeoutMs }));
  ipcMain.handle('checkForNewRelease', () => checkForNewRelease());
  ipcMain.handle('credentialStorageNotices', () => credentialStorageNotices(credentialStorageStatus()));
  ipcMain.handle('listSnapshots', () => listSnapshots());
  ipcMain.handle('takeSnapshot', () => takeSnapshot('manual'));
  ipcMain.handle('restoreSnapshot', (_, name: string) => restoreSnapshotOnRestart(name));
  ipcMain.handle('showSnapshotsFolder', async () => {
    await fs.promises.mkdir(getSnapshotsPath(), { recursive: true });
    await shell.openPath(getSnapshotsPath());
  });

  ipcMain.handle('curlRequest', (_, options: Parameters<typeof curlRequest>[0]) => {
    return curlRequest(options);
  });

  ipcMain.on('cancelCurlRequest', (_, requestId: string): void => {
    cancelCurlRequest(requestId);
  });

  ipcMain.on('trackSegmentEvent', (_, options: {}): void => {
  //  removed tracking from insomnia
  });
  ipcMain.on('trackPageView', (_, options: { name: string }): void => {
    // removed tracking from insomnia
  });

  ipcMain.handle('installPlugin', (_, lookupName: string) => {
    return installPlugin(lookupName);
  });

  ipcMain.on('restart', () => {
    app.relaunch();
    app.exit();
  });

  ipcMain.on('openInBrowser', (_, href: string) => {
    const { protocol } = new URL(href);
    if (protocol === 'http:' || protocol === 'https:') {
      // eslint-disable-next-line no-restricted-properties
      shell.openExternal(href);
    }
  });

  ipcMain.handle('spectralRun', async (_, options: { contents: string; rulesetPath?: string }) => lintSpec(options));
}
