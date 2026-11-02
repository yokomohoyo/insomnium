import { describe, expect, it, jest } from '@jest/globals';

import { appPageUrl, isAppPage, isAppSender, onlyAppSenders } from '../app-senders';

const app = 'file:///opt/Insomnium/resources/app.asar/index.html';
const frame = (url: string, parent: object | null = null) => ({ senderFrame: { url, parent } }) as any;

describe('isAppPage()', () => {
  it("is the app's own page, with any hash or query", () => {
    expect(isAppPage(app, app)).toBe(true);
    expect(isAppPage(`${app}#/organization`, app)).toBe(true);
    expect(isAppPage('file:///home/me/Downloads/index.html', app)).toBe(false);
    expect(isAppPage('https://example.com/index.html', app)).toBe(false);
    expect(isAppPage('not a url', app)).toBe(false);
    // the dev server's, in development
    expect(isAppPage('http://localhost:3334/some/route', 'http://localhost:3334')).toBe(true);
    expect(isAppPage('http://localhost:4000/', 'http://localhost:3334')).toBe(false);
  });

  it("is the sender only in a window's main frame", () => {
    const url = `${appPageUrl()}#/organization`;
    expect(isAppSender(frame(url))).toBe(true);
    expect(isAppSender(frame(url, {}))).toBe(false);
    expect(isAppSender({ senderFrame: null } as any)).toBe(false);
  });
});

describe('onlyAppSenders()', () => {
  const setUp = () => {
    const listeners: Record<string, (...args: any[]) => any> = {};
    const ipc = {
      on: (channel: string, listener: any) => {
        listeners[channel] = listener;
        return ipc;
      },
      handle: (channel: string, listener: any) => {
        listeners[channel] = listener;
      },
    };
    onlyAppSenders(ipc as any, event => event.senderFrame?.url === app);
    return { ipc: ipc as any, listeners };
  };

  it("answers the app's page, and nothing else", () => {
    const { ipc, listeners } = setUp();
    const handler = jest.fn(() => 'done');
    ipc.handle('writeFile', handler);
    expect(listeners.writeFile(frame(app), 'x')).toBe('done');
    expect(handler).toHaveBeenCalledWith(frame(app), 'x');
    expect(() => listeners.writeFile(frame('https://example.com/'), 'x')).toThrow("writeFile answers only the app's own page");
    expect(handler).toHaveBeenCalledTimes(1);

    const listener = jest.fn();
    ipc.on('openInBrowser', listener);
    const event = { ...frame('https://example.com/'), returnValue: undefined };
    listeners.openInBrowser(event, 'https://example.com/');
    expect(listener).not.toHaveBeenCalled();
    expect(event.returnValue).toBeNull();
    listeners.openInBrowser(frame(app), 'https://example.com/');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves a plugin's sandbox to its own handler", () => {
    const { ipc, listeners } = setUp();
    const read = jest.fn();
    ipc.on('plugin-host:read', read);
    listeners['plugin-host:read'](frame('file:///opt/Insomnium/resources/app.asar/plugin-host.html'), 'index.js');
    expect(read).toHaveBeenCalled();
  });
});
