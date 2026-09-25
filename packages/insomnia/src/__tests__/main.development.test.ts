import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'events';

const mockWindows: { webContents: unknown }[] = [];
const createMockWindow = () => {
  const window = {
    isMinimized: () => false,
    restore: jest.fn(),
    focus: jest.fn(),
    webContents: Object.assign(new EventEmitter(), { send: jest.fn(), getType: () => 'window' }),
  };
  mockWindows.push(window);
  return window;
};
// What windowUtils.getOrCreateWindow() returns; replaced to open a new window
let mockWindow = createMockWindow();

jest.mock('electron', () => {
  const { EventEmitter } = jest.requireActual('events') as typeof import('events');
  const app = Object.assign(new EventEmitter(), {
    setPath: () => {},
    getPath: () => '/tmp',
    setAsDefaultProtocolClient: () => true,
    requestSingleInstanceLock: () => true,
    quit: () => {},
  });
  const ipcMain = Object.assign(new EventEmitter(), { handle: () => {} });
  const session = {
    defaultSession: {
      setSpellCheckerDictionaryDownloadURL: () => {},
      webRequest: { onBeforeSendHeaders: () => {} },
    },
  };
  const BrowserWindow = {
    fromWebContents: (contents: unknown) => mockWindows.find(window => window.webContents === contents) || null,
  };
  const electron = { app, ipcMain, session, BrowserWindow };
  return { __esModule: true, default: electron, ...electron };
});
jest.mock('electron-context-menu', () => () => {});
jest.mock('electron-devtools-installer', () => ({}));
jest.mock('../common/log', () => ({ __esModule: true, default: { info: () => {} }, initializeLogging: () => {} }));
jest.mock('../common/database', () => ({
  database: { init: async () => {}, find: async () => [], onChange: () => {} },
}));
jest.mock('../common/import', () => ({}));
jest.mock('../main/backup', () => ({}));
jest.mock('../main/ipc/electron', () => ({ registerElectronHandlers: () => {} }));
jest.mock('../main/ipc/grpc', () => ({ registergRPCHandlers: () => {} }));
jest.mock('../main/ipc/main', () => ({ registerMainHandlers: () => {} }));
jest.mock('../main/network/curl', () => ({ registerCurlHandlers: () => {} }));
jest.mock('../main/network/websocket', () => ({ registerWebSocketHandlers: () => {} }));
jest.mock('../main/squirrel-startup', () => ({ checkIfRestartNeeded: () => false }));
jest.mock('../main/updates', () => ({}));
jest.mock('../main/mcp/server', () => ({ getRunningMcpServer: () => null }));
jest.mock('../main/window-utils', () => ({ init: () => {}, getOrCreateWindow: () => mockWindow }));
jest.mock('../models/index', () => ({
  types: () => [],
  stats: { get: async () => ({}) },
  settings: { type: 'Settings', getOrCreate: async () => ({ mcpEnabled: false }) },
  workspace: { type: 'Workspace' },
}));

const startApp = () => {
  require('../main.development');
  return jest.requireMock('electron') as { app: EventEmitter; ipcMain: EventEmitter };
};

const waitForLaunch = async (ipcMain: EventEmitter) => {
  while (!ipcMain.listenerCount('halfSecondAfterAppStart')) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

describe('main.development deep links', () => {
  const { argv } = process;
  beforeEach(() => {
    mockWindow = createMockWindow();
    process.argv = [argv[0]];
    delete process.env.PLAYWRIGHT;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.argv = argv;
    delete process.env.PLAYWRIGHT;
  });

  it('delivers a link that launched the app on macOS once the renderer is ready', async () => {
    const { app, ipcMain } = startApp();
    const event = { preventDefault: jest.fn() };
    const url = 'insomnia://app/import?uri=https%3A%2F%2Fexample.com%2Fspec.yaml';

    // 'open-url' fires before 'ready' on a cold start
    app.emit('open-url', event, url);
    expect(event.preventDefault).toHaveBeenCalled();

    app.emit('ready');
    await waitForLaunch(ipcMain);
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    expect(mockWindow.focus).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
    // The window is brought to the front as the held link opens
    expect(mockWindow.focus).toHaveBeenCalled();
  });

  it('delivers links straight away once the renderer is ready', async () => {
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });

    app.emit('open-url', { preventDefault: () => {} }, 'insomnia://app/alert?title=hi');
    expect(mockWindow.focus).toHaveBeenCalled();
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', 'insomnia://app/alert?title=hi');
  });

  it('delivers only the link from a command line that launched the app', async () => {
    const url = 'insomnia://app/alert?title=ColdStart';
    // The AppImage and snap launchers put --no-sandbox before the URL
    process.argv = ['/opt/Insomnium/insomnium', '--no-sandbox', url];
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
  });

  it('holds a link from a second instance until the renderer is ready', async () => {
    const url = 'insomnia://app/alert?title=Second';
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);

    app.emit('second-instance', {}, ['/opt/Insomnium/insomnium', '--no-sandbox', url]);
    expect(mockWindow.focus).toHaveBeenCalled();
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
  });

  it('holds a link that opens a new window until that window is listening', async () => {
    const url = 'insomnia://app/alert?title=NoWindow';
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });

    // On macOS the app keeps running with all windows closed, so the link gets a new window
    const firstWindow = mockWindow;
    mockWindow = createMockWindow();
    app.emit('open-url', { preventDefault: () => {} }, url);
    expect(mockWindow.focus).toHaveBeenCalled();
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
    expect(firstWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('holds a link from a second instance that opens a new window', async () => {
    const url = 'insomnia://app/alert?title=SecondNoWindow';
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });

    mockWindow = createMockWindow();
    app.emit('second-instance', {}, ['/opt/Insomnium/insomnium', url]);
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
  });

  it('holds links while a window reloads', async () => {
    const url = 'insomnia://app/alert?title=Reload';
    const { app, ipcMain } = startApp();
    app.emit('web-contents-created', {}, mockWindow.webContents);
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });

    mockWindow.webContents.emit('did-navigate');
    app.emit('open-url', { preventDefault: () => {} }, url);
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
  });

  it('delivers command line links only once when more windows become ready', async () => {
    const url = 'insomnia://app/alert?title=Once';
    process.argv = ['/opt/Insomnium/insomnium', url];
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);

    const secondWindow = createMockWindow();
    ipcMain.emit('halfSecondAfterAppStart', { sender: secondWindow.webContents });
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(secondWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('keeps a held link with the new window it opened, not another window that becomes ready', async () => {
    const url = 'insomnia://app/alert?title=Crossover';
    const { app, ipcMain } = startApp();
    const firstWindow = mockWindow;
    app.emit('web-contents-created', {}, firstWindow.webContents);
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: firstWindow.webContents });

    mockWindow = createMockWindow();
    app.emit('open-url', { preventDefault: () => {} }, url);
    // The first window reloads and signals before the new one has loaded
    firstWindow.webContents.emit('did-navigate');
    ipcMain.emit('halfSecondAfterAppStart', { sender: firstWindow.webContents });
    expect(firstWindow.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
  });

  it('drops a held link when its window is closed before it loads', async () => {
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });

    const closedWindow = createMockWindow();
    mockWindow = closedWindow;
    app.emit('web-contents-created', {}, closedWindow.webContents);
    app.emit('open-url', { preventDefault: () => {} }, 'insomnia://app/alert?title=Stale');
    closedWindow.webContents.emit('destroyed');

    // A window opened later, for example from the dock, does not get the old link
    mockWindow = createMockWindow();
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    app.emit('open-url', { preventDefault: () => {} }, 'insomnia://app/alert?title=Fresh');
    expect(mockWindow.webContents.send.mock.calls).toEqual([['shell:open', 'insomnia://app/alert?title=Fresh']]);
    expect(closedWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('holds links after the renderer crashes or a reload ends on an error page', async () => {
    const { app, ipcMain } = startApp();
    const contents = mockWindow.webContents;
    app.emit('web-contents-created', {}, contents);
    app.emit('ready');
    await waitForLaunch(ipcMain);
    const openUrl = (title: string) => app.emit('open-url', { preventDefault: () => {} }, `insomnia://app/alert?title=${title}`);

    ipcMain.emit('halfSecondAfterAppStart', { sender: contents });
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    openUrl('Crash');
    expect(contents.send).not.toHaveBeenCalled();

    ipcMain.emit('halfSecondAfterAppStart', { sender: contents });
    contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:3334/', true);
    openUrl('ErrorPage');
    expect(contents.send.mock.calls).toEqual([['shell:open', 'insomnia://app/alert?title=Crash']]);

    // A cancelled load or a failing subframe leaves the page listening
    ipcMain.emit('halfSecondAfterAppStart', { sender: contents });
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'http://localhost:3334/', true);
    contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://example.com/', false);
    openUrl('StillListening');
    expect(contents.send.mock.calls).toEqual([
      ['shell:open', 'insomnia://app/alert?title=Crash'],
      ['shell:open', 'insomnia://app/alert?title=ErrorPage'],
      ['shell:open', 'insomnia://app/alert?title=StillListening'],
    ]);
  });

  it('ignores command line links under playwright', async () => {
    process.env.PLAYWRIGHT = 'true';
    process.argv = ['/opt/Insomnium/insomnium', 'insomnia://app/alert?title=Playwright'];
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart', { sender: mockWindow.webContents });
    expect(mockWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('does not listen for links under playwright', () => {
    process.env.PLAYWRIGHT = 'true';
    const { app } = startApp();
    expect(app.listenerCount('open-url')).toBe(0);
  });
});
