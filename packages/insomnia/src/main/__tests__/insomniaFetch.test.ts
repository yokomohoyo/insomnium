import { describe, expect, it, jest } from '@jest/globals';

import { deepLinks } from '../deep-link-buffer';
import { insomniaFetch } from '../insomniaFetch';

const mockLoaded = { send: jest.fn() };
const mockLoading = { send: jest.fn() };

jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: mockLoaded }, { webContents: mockLoading }],
  },
  net: {
    fetch: async () => ({
      status: 200,
      ok: true,
      headers: new Map([['x-insomnia-command', 'insomnia://app/alert?title=cmd']]),
      text: async () => 'ok',
    }),
  },
}));

describe('insomniaFetch()', () => {
  it('holds a command from the server for a window that is still loading', async () => {
    deepLinks.ready(mockLoaded as never);

    await insomniaFetch({ method: 'GET', path: '/check', sessionId: null, origin: 'https://example.com' });
    expect(mockLoaded.send.mock.calls).toEqual([['shell:open', 'insomnia://app/alert?title=cmd']]);
    expect(mockLoading.send).not.toHaveBeenCalled();

    deepLinks.ready(mockLoading as never);
    expect(mockLoading.send.mock.calls).toEqual([['shell:open', 'insomnia://app/alert?title=cmd']]);
  });
});
