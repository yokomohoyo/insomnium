// The preload of a plugin's sandbox (main/plugin-sandbox.ts): its only ways
// out are the port to the app's window, and reading the plugin's own code.
import { contextBridge, ipcRenderer } from 'electron';

ipcRenderer.once('plugin-host:start', (event, data) => window.postMessage({ type: 'plugin-host:start', data }, '*', event.ports));

contextBridge.exposeInMainWorld('pluginHost', {
  read: (file: string): string | null => ipcRenderer.sendSync('plugin-host:read', String(file)),
});
