import { describe, expect, it, jest } from '@jest/globals';

import * as windowUtils from '../window-utils';

jest.mock('electron', () => {
  const { EventEmitter } = jest.requireActual('events') as typeof import('events');
  class BrowserWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: () => {} });
    loadURL() {}
    maximize() {}
  }
  const electron = {
    app: { getPath: () => '/tmp', getName: () => 'Insomnium' },
    BrowserWindow,
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
    screen: { getAllDisplays: () => [] },
    shell: {},
    dialog: {},
    clipboard: {},
  };
  return { __esModule: true, default: electron, ...electron };
});
jest.mock('../../common/log', () => ({}));
jest.mock('../local-storage', () => class {
  getItem(_key: string, defaultValue: unknown) {
    return defaultValue;
  }
});

describe('getOrCreateWindow()', () => {
  it('returns a window that is still open after an older one closes', () => {
    windowUtils.init();
    const older = windowUtils.createWindow();
    const newer = windowUtils.createWindow();

    older.emit('closed');
    expect(windowUtils.getOrCreateWindow()).toBe(newer);

    newer.emit('closed');
    const reopened = windowUtils.getOrCreateWindow();
    expect(reopened).not.toBe(older);
    expect(reopened).not.toBe(newer);
  });
});
