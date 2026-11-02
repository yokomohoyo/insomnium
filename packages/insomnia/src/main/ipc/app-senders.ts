import electron, { type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { env } from 'node:process';
import path from 'path';
import { pathToFileURL } from 'url';

// The page the app's windows load: the dev server's, in development; a release
// build loads only its own page, since those windows have Node
export function appPageUrl() {
  return (!electron.app.isPackaged && env.APP_RENDER_URL) || pathToFileURL(path.resolve(__dirname, './index.html')).href;
}

export function isAppPage(url: string, appUrl = appPageUrl()) {
  try {
    const page = new URL(url);
    const app = new URL(appUrl);
    return app.protocol === 'file:' ? page.protocol === 'file:' && page.pathname === app.pathname : page.origin === app.origin;
  } catch {
    return false;
  }
}

type Sender = Pick<IpcMainEvent, 'senderFrame'>;

// the app's page, in a window's main frame, and not whatever a frame or a
// navigated window has loaded since
export const isAppSender = (event: Sender) => {
  const frame = event.senderFrame;
  return !!frame && !frame.parent && isAppPage(frame.url);
};

// a plugin's sandbox reading its code: its handler knows its own windows
const ownSenders = (channel: string) => channel.startsWith('plugin-host:');

// Every IPC handler, registered after this, answers only the app's page.
export function onlyAppSenders(ipc: Pick<IpcMain, 'on' | 'handle'>, trusted: (event: Sender) => boolean = isAppSender) {
  const on = ipc.on.bind(ipc);
  const handle = ipc.handle.bind(ipc);
  ipc.on = (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) => on(channel, (event: IpcMainEvent, ...args: any[]) => {
    if (ownSenders(channel) || trusted(event)) {
      return listener(event, ...args);
    }
    console.warn(`[ipc] ignored ${channel} from ${event.senderFrame?.url ?? 'a gone frame'}`);
    // a sendSync waits for an answer
    event.returnValue = null;
  }) as IpcMain;
  ipc.handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => handle(channel, (event: IpcMainInvokeEvent, ...args: any[]) => {
    if (ownSenders(channel) || trusted(event)) {
      return listener(event, ...args);
    }
    throw new Error(`${channel} answers only the app's own page`);
  });
}
