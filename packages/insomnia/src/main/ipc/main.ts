import type { ISpectralDiagnostic } from '@stoplight/spectral-core';
import { app, BrowserWindow, ipcMain, IpcRendererEvent, shell } from 'electron';
import fs from 'fs';

import { credentialStorageStatus } from '../../common/database';
import type { NativeThemeSource } from '../../plugins/native-theme';
import { runInSandbox, SandboxResult } from '../../scripting/sandbox';
import type { UpdateCheckResult } from '../../common/update-check';
import type { ToastNotification } from '../../ui/components/toast';
import { type AiBridgeAPI, aiChat, aiModels, type ChatMessage } from '../ai';
import { type TeamBridgeAPI, teamCollections, teamConnect, teamConnectSso, teamCreateCollection, teamDisconnect } from '../team-client';
import { authorizeInSystemBrowser } from '../authorize-in-system-browser';
import { type CaptureBridgeAPI, registerCaptureHandlers } from '../capture-proxy';
import { authorizeUserInWindow } from '../authorizeUserInWindow';
import { credentialStorageNotices } from '../credential-keys';
import { insomniaFetch } from '../insomniaFetch';
import { collectionMockStatus, type MockServerStatus, startCollectionMock, stopCollectionMock } from '../mock-servers';
import * as models from '../../models';
import installPlugin, { installPluginFromFile, pluginInstallOptions } from '../install-plugin';
import { axiosRequest } from '../network/axios-request';
import type { GitSshRequest, GitSshResponse } from '../git-ssh/transport';
import { checkForNewRelease, checkForUpdatesNow } from '../release-check';
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
  // the colours of the window's frame and menu bar (plugins/native-theme.ts)
  setNativeTheme: (source: NativeThemeSource) => void;
  installPlugin: (lookupName: string) => Promise<void>;
  // a package tarball's path; resolves with the plugin's name
  installPluginFromFile: (file: string) => Promise<string>;
  openPluginSandbox: (options: { directory: string; name: string }) => Promise<{ id: string; port: MessagePort }>;
  closePluginSandbox: (id: string) => void;
  // a sandbox the main process closed, as its plugin hung or crashed it
  onPluginSandboxClosed: (listener: (id: string) => void) => () => void;
  writeFile: (options: { path: string; content: string }) => Promise<string>;
  cancelCurlRequest: typeof cancelCurlRequest;
  curlRequest: typeof curlRequest;
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => () => void;
  webSocket: WebSocketBridgeAPI;
  ai: AiBridgeAPI;
  team: TeamBridgeAPI;
  capture: CaptureBridgeAPI;
  mcpClient: McpClientBridgeAPI;
  folderSync: FolderSyncBridgeAPI;
  grpc: gRPCBridgeAPI;
  curl: CurlBridgeAPI;
  trackSegmentEvent: (options: { event: string; properties?: Record<string, unknown> }) => void;
  trackPageView: (options: { name: string }) => void;
  axiosRequest: typeof axiosRequest;
  // one of isomorphic-git's requests of an SSH remote (main/git-ssh)
  gitSshRequest: (request: GitSshRequest) => Promise<GitSshResponse>;
  insomniaFetch: typeof insomniaFetch;
  showContextMenu: (options: { key: string }) => void;
  webUtilsGetPathForFile: (file: File) => string;
  getMcpStatus: () => Promise<{ running: boolean; port: number | null }>;
  checkForNewRelease: () => Promise<ToastNotification | null>;
  // asked for now, opted in to the daily check or not
  checkForUpdatesNow: () => Promise<UpdateCheckResult>;
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
// a plugin installed in place of one of its name is new code: it starts
// sandboxed, whatever the one before was allowed
async function revokeFullAccess(name: string) {
  const { pluginConfig } = await models.settings.getOrCreate();
  const config = pluginConfig?.[name];
  if (config?.fullAccess) {
    await models.settings.patch({ pluginConfig: { ...pluginConfig, [name]: { ...config, fullAccess: false, fullAccessDirectory: undefined } } });
  }
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
  ipcMain.handle('checkForUpdatesNow', () => checkForUpdatesNow());
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

  registerCaptureHandlers();

  ipcMain.handle('ai.chat', (_, options: { messages: ChatMessage[] }) => aiChat(options));
  ipcMain.handle('ai.models', () => aiModels());

  ipcMain.handle('team.connect', (_, options: Parameters<typeof teamConnect>[0]) => teamConnect(options));
  ipcMain.handle('team.connectSso', (_, options: { url: string }) => teamConnectSso(options));
  ipcMain.handle('team.disconnect', (_, options: Parameters<typeof teamDisconnect>[0]) => teamDisconnect(options));
  ipcMain.handle('team.collections', (_, options: Parameters<typeof teamCollections>[0]) => teamCollections(options));
  ipcMain.handle('team.create', (_, options: Parameters<typeof teamCreateCollection>[0]) => teamCreateCollection(options));

  ipcMain.handle('installPlugin', async (_, lookupName: string) => {
    await revokeFullAccess(await installPlugin(lookupName, await pluginInstallOptions(await models.settings.getOrCreate())));
  });

  ipcMain.handle('installPluginFromFile', async (_, file: string) => {
    const name = await installPluginFromFile(file, await pluginInstallOptions(await models.settings.getOrCreate()));
    await revokeFullAccess(name);
    return name;
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
