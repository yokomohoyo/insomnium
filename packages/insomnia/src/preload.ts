import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { gRPCBridgeAPI } from './main/ipc/grpc';
import { CurlBridgeAPI } from './main/network/curl';
import type { AiBridgeAPI } from './main/ai';
import type { CaptureBridgeAPI } from './main/capture-proxy';
import type { FolderSyncBridgeAPI } from './main/folder-sync';
import type { McpClientBridgeAPI } from './main/network/mcp-client';
import type { TeamBridgeAPI } from './main/team-client';
import type { WebSocketBridgeAPI } from './main/network/websocket';

const folderSync: FolderSyncBridgeAPI = {
  start: options => ipcRenderer.invoke('folderSync.start', options),
  stop: options => ipcRenderer.invoke('folderSync.stop', options),
  status: options => ipcRenderer.invoke('folderSync.status', options),
};

const capture: CaptureBridgeAPI = {
  start: options => ipcRenderer.invoke('capture.start', options),
  stop: () => ipcRenderer.invoke('capture.stop'),
  status: () => ipcRenderer.invoke('capture.status'),
  list: () => ipcRenderer.invoke('capture.list'),
  get: options => ipcRenderer.invoke('capture.get', options),
  clear: () => ipcRenderer.invoke('capture.clear'),
};

const ai: AiBridgeAPI = {
  chat: options => ipcRenderer.invoke('ai.chat', options),
  models: () => ipcRenderer.invoke('ai.models'),
};

const team: TeamBridgeAPI = {
  connect: options => ipcRenderer.invoke('team.connect', options),
  connectSso: options => ipcRenderer.invoke('team.connectSso', options),
  disconnect: options => ipcRenderer.invoke('team.disconnect', options),
  collections: options => ipcRenderer.invoke('team.collections', options),
  create: options => ipcRenderer.invoke('team.create', options),
};

const mcpClient: McpClientBridgeAPI = {
  connect: options => ipcRenderer.invoke('mcpClient.connect', options),
  call: options => ipcRenderer.invoke('mcpClient.call', options),
  disconnect: options => ipcRenderer.invoke('mcpClient.disconnect', options),
  isConnected: options => ipcRenderer.invoke('mcpClient.isConnected', options),
};

const webSocket: WebSocketBridgeAPI = {
  open: options => ipcRenderer.invoke('webSocket.open', options),
  close: options => ipcRenderer.send('webSocket.close', options),
  closeAll: () => ipcRenderer.send('webSocket.closeAll'),
  readyState: {
    getCurrent: options => ipcRenderer.invoke('webSocket.readyState', options),
  },
  event: {
    findMany: options => ipcRenderer.invoke('webSocket.event.findMany', options),
    findSince: options => ipcRenderer.invoke('webSocket.event.findSince', options),
    send: options => ipcRenderer.invoke('webSocket.event.send', options),
  },
};
const curl: CurlBridgeAPI = {
  open: options => ipcRenderer.invoke('curl.open', options),
  close: options => ipcRenderer.send('curl.close', options),
  closeAll: () => ipcRenderer.send('curl.closeAll'),
  readyState: {
    getCurrent: options => ipcRenderer.invoke('curl.readyState', options),
  },
  event: {
    findMany: options => ipcRenderer.invoke('curl.event.findMany', options),
    findSince: options => ipcRenderer.invoke('curl.event.findSince', options),
  },
};

const grpc: gRPCBridgeAPI = {
  start: options => ipcRenderer.send('grpc.start', options),
  sendMessage: options => ipcRenderer.send('grpc.sendMessage', options),
  commit: options => ipcRenderer.send('grpc.commit', options),
  cancel: options => ipcRenderer.send('grpc.cancel', options),
  closeAll: () => ipcRenderer.send('grpc.closeAll'),
  loadMethods: options => ipcRenderer.invoke('grpc.loadMethods', options),
  loadMethodsFromReflection: options => ipcRenderer.invoke('grpc.loadMethodsFromReflection', options),
  fetchProto: (url, tokens) => ipcRenderer.invoke('grpc.fetchProto', url, tokens),
  validateProto: (filePath, includeDirs) => ipcRenderer.invoke('grpc.validateProto', filePath, includeDirs),
};
const main: Window['main'] = {
  loginStateChange: () => ipcRenderer.send('loginStateChange'),
  restart: () => ipcRenderer.send('restart'),
  openInBrowser: options => ipcRenderer.send('openInBrowser', options),
  halfSecondAfterAppStart: () => ipcRenderer.send('halfSecondAfterAppStart'),
  getMcpStatus: () => ipcRenderer.invoke('getMcpStatus'),
  checkForNewRelease: () => ipcRenderer.invoke('checkForNewRelease'),
  checkForUpdatesNow: () => ipcRenderer.invoke('checkForUpdatesNow'),
  credentialStorageNotices: () => ipcRenderer.invoke('credentialStorageNotices'),
  listSnapshots: () => ipcRenderer.invoke('listSnapshots'),
  takeSnapshot: () => ipcRenderer.invoke('takeSnapshot'),
  restoreSnapshot: name => ipcRenderer.invoke('restoreSnapshot', name),
  showSnapshotsFolder: () => ipcRenderer.invoke('showSnapshotsFolder'),
  mockServer: {
    start: options => ipcRenderer.invoke('mockServer.start', options),
    stop: workspaceId => ipcRenderer.invoke('mockServer.stop', workspaceId),
    status: workspaceId => ipcRenderer.invoke('mockServer.status', workspaceId),
  },
  authorizeUserInWindow: options => ipcRenderer.invoke('authorizeUserInWindow', options),
  authorizeInSystemBrowser: options => ipcRenderer.invoke('authorizeInSystemBrowser', options),
  spectralRun: options => ipcRenderer.invoke('spectralRun', options),
  runScript: options => ipcRenderer.invoke('runScript', options),
  setMenuBarVisibility: options => ipcRenderer.send('setMenuBarVisibility', options),
  setNativeTheme: source => ipcRenderer.send('setNativeTheme', source),
  installPlugin: options => ipcRenderer.invoke('installPlugin', options),
  installPluginFromFile: file => ipcRenderer.invoke('installPluginFromFile', file),
  // a plugin without full access, in its sandbox: the port to it (main/plugin-sandbox.ts)
  openPluginSandbox: ({ directory, name }) => new Promise((resolve, reject) => {
    const id = `${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const listener = (event: Electron.IpcRendererEvent, data: { id: string; error?: string }) => {
      if (data.id !== id) {
        return;
      }
      ipcRenderer.removeListener('plugin-sandbox:port', listener);
      if (data.error || !event.ports[0]) {
        reject(new Error(data.error || 'The plugin sandbox did not start'));
      } else {
        resolve({ id, port: event.ports[0] });
      }
    };
    ipcRenderer.on('plugin-sandbox:port', listener);
    ipcRenderer.send('plugin-sandbox:open', { id, directory, name });
  }),
  closePluginSandbox: id => ipcRenderer.send('plugin-sandbox:close', id),
  onPluginSandboxClosed: listener => {
    const closed = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on('plugin-sandbox:closed', closed);
    return () => ipcRenderer.removeListener('plugin-sandbox:closed', closed);
  },
  curlRequest: options => ipcRenderer.invoke('curlRequest', options),
  cancelCurlRequest: options => ipcRenderer.send('cancelCurlRequest', options),
  writeFile: options => ipcRenderer.invoke('writeFile', options),
  on: (channel, listener) => {
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  webSocket,
  mcpClient,
  folderSync,
  ai,
  team,
  capture,
  grpc,
  curl,
  trackSegmentEvent: options => ipcRenderer.send('trackSegmentEvent', options),
  trackPageView: options => ipcRenderer.send('trackPageView', options),
  axiosRequest: options => ipcRenderer.invoke('axiosRequest', options),
  gitSshRequest: request => ipcRenderer.invoke('gitSshRequest', request),
  insomniaFetch: options => ipcRenderer.invoke('insomniaFetch', options),
  showContextMenu: options => ipcRenderer.send('show-context-menu', options),
  webUtilsGetPathForFile: (file: File) => webUtils.getPathForFile(file),
};
const dialog: Window['dialog'] = {
  showOpenDialog: options => ipcRenderer.invoke('showOpenDialog', options),
  showSaveDialog: options => ipcRenderer.invoke('showSaveDialog', options),
};
const app: Window['app'] = {
  getPath: options => ipcRenderer.sendSync('getPath', options),
  getAppPath: () => ipcRenderer.sendSync('getAppPath'),
};
const shell: Window['shell'] = {
  showItemInFolder: options => ipcRenderer.send('showItemInFolder', options),
};
const clipboard: Window['clipboard'] = {
  readText: () => ipcRenderer.sendSync('readText'),
  writeText: options => ipcRenderer.send('writeText', options),
  clear: () => ipcRenderer.send('clear'),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('main', main);
  contextBridge.exposeInMainWorld('dialog', dialog);
  contextBridge.exposeInMainWorld('app', app);
  contextBridge.exposeInMainWorld('shell', shell);
  contextBridge.exposeInMainWorld('clipboard', clipboard);
} else {
  window.main = main;
  window.dialog = dialog;
  window.app = app;
  window.shell = shell;
  window.clipboard = clipboard;
}
