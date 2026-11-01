/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';

// whether Spectral (spectral-lint.ts and what it brings) has been loaded
let mockSpectralLoaded = false;
jest.mock('../../spectral-lint', () => {
  mockSpectralLoaded = true;
  return { lintSpec: async () => [{ code: 'linted' }] };
});

const handlers = new Map<string, (...args: unknown[]) => unknown>();
jest.mock('electron', () => ({
  ...(jest.requireActual('electron') as object),
  ipcMain: {
    on: () => {},
    once: () => {},
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

describe('the spectralRun handler', () => {
  it('loads Spectral when it first lints, not as the app starts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../main').registerMainHandlers();
    expect(handlers.has('spectralRun')).toBe(true);
    expect(mockSpectralLoaded).toBe(false);

    expect(await handlers.get('spectralRun')!({}, { contents: 'openapi: 3.0.0' })).toEqual([{ code: 'linted' }]);
    expect(mockSpectralLoaded).toBe(true);
  });
});
