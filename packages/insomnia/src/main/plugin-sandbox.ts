// The sandboxes plugins without full access run in (plugins/sandbox): a hidden
// window per plugin, sandboxed by the OS and Chromium, with no Node.js, on a
// session that sends nothing anywhere. The window that loads the plugin and
// the sandbox talk over a MessagePort; the sandbox reads the plugin's own files
// (its code, and its node_modules') through a channel that reads nothing else.
import { BrowserWindow, ipcMain, MessageChannelMain, session, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { isDevelopment } from '../common/constants';

export const PLUGIN_SANDBOX_PARTITION = 'plugin-sandbox';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const CODE = /\.(c?js|json)$/i;

interface Sandbox {
  window: BrowserWindow;
  owner: WebContents;
  // the folders it may read code from
  roots: string[];
}

const sandboxes = new Map<string, Sandbox>();
const bySender = new Map<number, Sandbox>();

const hostFile = (name: string) => path.join(__dirname, name);
const isHostPage = (url: string) => [hostFile('plugin-host.html'), hostFile('plugin-host.js')].some(file => url === pathToFileURL(file).href);

let lockedDown = false;
function sandboxSession() {
  const sandboxed = session.fromPartition(PLUGIN_SANDBOX_PARTITION);
  if (!lockedDown) {
    lockedDown = true;
    // nothing leaves: no request but for the sandbox's own page, and no permissions
    sandboxed.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isHostPage(details.url) && !/^devtools:/.test(details.url) }));
    sandboxed.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    sandboxed.setPermissionCheckHandler(() => false);
    // WebRTC goes around webRequest: it may only go through a proxy, which goes nowhere
    sandboxed.setProxy({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '' });
    sandboxed.on('will-download', event => event.preventDefault());
  }
  return sandboxed;
}

// where a plugin's code can come from: its own folder, and the node_modules folder it sits in, if it does
export function codeRoots(directory: string) {
  const roots = [path.resolve(directory)];
  const parent = path.dirname(roots[0]);
  if (path.basename(parent) === 'node_modules' || path.basename(path.dirname(parent)) === 'node_modules') {
    roots.push(path.basename(parent) === 'node_modules' ? parent : path.dirname(parent));
  }
  return roots;
}

const within = (file: string, root: string) => {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// a file of the plugin's, if it's code under one of its roots (after following links)
export function readPluginFile(file: string, roots: string[]): string | null {
  if (typeof file !== 'string' || !CODE.test(file)) {
    return null;
  }
  try {
    const real = fs.realpathSync(path.resolve(file));
    const realRoots = roots.map(root => fs.realpathSync(root));
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE || !realRoots.some(root => within(real, root))) {
      return null;
    }
    return fs.readFileSync(real, 'utf8');
  } catch {
    return null;
  }
}

function close(id: string) {
  const sandbox = sandboxes.get(id);
  if (!sandbox) {
    return;
  }
  sandboxes.delete(id);
  if (!sandbox.window.isDestroyed()) {
    bySender.delete(sandbox.window.webContents.id);
    sandbox.window.destroy();
  }
}

function closeAllOf(owner: WebContents) {
  for (const [id, sandbox] of sandboxes) {
    if (sandbox.owner === owner) {
      close(id);
    }
  }
}

async function open(owner: WebContents, id: string, directory: string, name: string) {
  const window = new BrowserWindow({
    show: false,
    title: `Plugin: ${name}`,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: false,
      session: sandboxSession(),
      preload: hostFile('plugin-host-preload.js'),
      devTools: isDevelopment(),
    },
  });
  const sandbox: Sandbox = { window, owner, roots: codeRoots(directory) };
  sandboxes.set(id, sandbox);
  bySender.set(window.webContents.id, sandbox);
  window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => {
    if (!isHostPage(event.url)) {
      event.preventDefault();
    }
  });
  // a plugin that hangs its sandbox is unloaded, as one that crashes it
  window.webContents.on('unresponsive', () => close(id));
  window.webContents.on('render-process-gone', () => close(id));

  await window.loadFile(hostFile('plugin-host.html'));
  const { port1, port2 } = new MessageChannelMain();
  window.webContents.postMessage('plugin-host:start', { directory: path.resolve(directory) }, [port1]);
  owner.postMessage('plugin-sandbox:port', { id }, [port2]);
}

// the windows whose sandboxes go when they do, or when they load again
const watched = new WeakSet<WebContents>();
function watch(owner: WebContents) {
  if (watched.has(owner)) {
    return;
  }
  watched.add(owner);
  owner.once('destroyed', () => closeAllOf(owner));
  owner.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) {
      closeAllOf(owner);
    }
  });
}

export function registerPluginSandboxHandlers() {
  ipcMain.on('plugin-sandbox:open', async (event, { id, directory, name }: { id: string; directory: string; name: string }) => {
    try {
      watch(event.sender);
      await open(event.sender, id, directory, name);
    } catch (err) {
      close(id);
      event.sender.send('plugin-sandbox:port', { id, error: err instanceof Error ? err.message : String(err) });
    }
  });
  ipcMain.on('plugin-sandbox:close', (_event, id: string) => close(id));
  // a sandbox reading the plugin's code, a file at a time, as its require needs it
  ipcMain.on('plugin-host:read', (event, file: string) => {
    const sandbox = bySender.get(event.sender.id);
    event.returnValue = sandbox ? readPluginFile(file, sandbox.roots) : null;
  });
}
