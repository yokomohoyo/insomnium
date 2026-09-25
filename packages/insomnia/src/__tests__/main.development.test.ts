import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { EventEmitter } from 'events';

const mockWindow = {
  isMinimized: () => false,
  restore: jest.fn(),
  focus: jest.fn(),
  webContents: { send: jest.fn() },
};

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
  const electron = { app, ipcMain, session };
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

    ipcMain.emit('halfSecondAfterAppStart');
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
  });

  it('delivers links straight away once the renderer is ready', async () => {
    const { app, ipcMain } = startApp();
    app.emit('ready');
    await waitForLaunch(ipcMain);
    ipcMain.emit('halfSecondAfterAppStart');

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

    ipcMain.emit('halfSecondAfterAppStart');
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

    ipcMain.emit('halfSecondAfterAppStart');
    expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('shell:open', url);
  });

  it('does not listen for links under playwright', () => {
    process.env.PLAYWRIGHT = 'true';
    const { app } = startApp();
    expect(app.listenerCount('open-url')).toBe(0);
  });
});
