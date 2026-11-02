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
// what a sandbox may read in all: its plugin's code, many times over
const MAX_READS = 10_000;
const MAX_READ_BYTES = 256 * 1024 * 1024;
const CODE = /\.(c?js|json)$/i;

interface Sandbox {
  window: BrowserWindow;
  owner: WebContents;
  // the folders it may read code from
  roots: string[];
  reads: number;
  bytes: number;
}

const sandboxes = new Map<string, Sandbox>();
const bySender = new Map<number, Sandbox>();

const hostFile = (name: string) => path.join(__dirname, name);
const isHostPage = (url: string) => [hostFile('plugin-host.html'), hostFile('plugin-host.js')].some(file => url === pathToFileURL(file).href);

// a session of its own for each plugin, kept in memory: plugins don't share
// storage. Each is locked down the first time it's used.
const lockedDown = new Set<string>();
function sandboxSession(name: string) {
  const partition = `${PLUGIN_SANDBOX_PARTITION}:${name}`;
  const sandboxed = session.fromPartition(partition);
  if (!lockedDown.has(partition)) {
    lockedDown.add(partition);
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

const within = (file: string, root: string) => {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const MAX_DEPENDENCIES = 1000;

const dependenciesOf = (folder: string) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
    return [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]
      .flatMap(names => (names && typeof names === 'object' ? Object.keys(names) : []));
  } catch {
    return [];
  }
};

// where a plugin's code can come from: its own folder and, if it sits in a
// node_modules folder, the packages there it depends on (and they do), but not
// the other plugins and packages beside it
export function codeRoots(directory: string) {
  const own = path.resolve(directory);
  const parent = path.dirname(own);
  const shared = path.basename(parent) === 'node_modules' ? parent : path.basename(path.dirname(parent)) === 'node_modules' ? path.dirname(parent) : null;
  const roots = [own];
  if (!shared) {
    return roots;
  }
  const queue = [own];
  while (queue.length && roots.length < MAX_DEPENDENCIES) {
    for (const name of dependenciesOf(queue.shift() as string)) {
      const folder = path.join(shared, name);
      // a dependency of its own (in a nested node_modules) is under its root already
      if (/^(@[\w.-]+\/)?[\w.-]+$/.test(name) && within(folder, shared) && !roots.includes(folder) && fs.existsSync(folder)) {
        roots.push(folder);
        queue.push(folder);
      }
    }
  }
  return roots;
}

// a file of the plugin's, if it's code under one of its roots (after following links)
export function readPluginFile(file: string, roots: string[]): string | null {
  if (typeof file !== 'string' || !CODE.test(file)) {
    return null;
  }
  let fd: number | undefined;
  try {
    const real = fs.realpathSync(path.resolve(file));
    if (!roots.map(root => fs.realpathSync(root)).some(root => within(real, root))) {
      return null;
    }
    // what's checked and what's read are the one file opened
    fd = fs.openSync(real, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
      return null;
    }
    return fs.readFileSync(fd, 'utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

// notify: closed here (the plugin hung or crashed it), not by its window, which is told
function close(id: string, notify = false) {
  const sandbox = sandboxes.get(id);
  if (!sandbox) {
    return;
  }
  sandboxes.delete(id);
  if (!sandbox.window.isDestroyed()) {
    bySender.delete(sandbox.window.webContents.id);
    sandbox.window.destroy();
  }
  if (notify && !sandbox.owner.isDestroyed()) {
    sandbox.owner.send('plugin-sandbox:closed', id);
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
      session: sandboxSession(name),
      preload: hostFile('plugin-host-preload.js'),
      devTools: isDevelopment(),
    },
  });
  const sandbox: Sandbox = { window, owner, roots: codeRoots(directory), reads: 0, bytes: 0 };
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
  window.webContents.on('unresponsive', () => close(id, true));
  window.webContents.on('render-process-gone', () => close(id, true));

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
    if (!sandbox || sandbox.reads >= MAX_READS || sandbox.bytes >= MAX_READ_BYTES) {
      event.returnValue = null;
      return;
    }
    const text = readPluginFile(file, sandbox.roots);
    sandbox.reads++;
    sandbox.bytes += text?.length ?? 0;
    event.returnValue = text;
  });
}
