import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { applyColorScheme } from '../../../plugins/misc';
import { useThemeChange } from '../use-theme-change';

jest.mock('../../../plugins/misc', () => ({ applyColorScheme: jest.fn() }));

describe('useThemeChange()', () => {
  const listeners = new Set<(event: Event) => Promise<void>>();
  // the OS going light or dark, and the listeners done with it
  const osChanges = () => Promise.all([...listeners].map(listener => listener(new Event('change'))));

  beforeEach(async () => {
    await globalBeforeEach();
    listeners.clear();
    jest.mocked(applyColorScheme).mockClear();
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, listener: (event: Event) => Promise<void>) => listeners.add(listener),
      removeEventListener: (_: string, listener: (event: Event) => Promise<void>) => listeners.delete(listener),
    }) as unknown as MediaQueryList;
  });

  it('listens once however often it renders, and stops when unmounted', () => {
    const { rerender, unmount } = renderHook(() => useThemeChange());
    rerender();
    rerender();
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('follows the OS only while the settings, as they are when it changes, say to', async () => {
    renderHook(() => useThemeChange());
    await models.settings.patch({ autoDetectColorScheme: false });
    await osChanges();
    expect(applyColorScheme).not.toHaveBeenCalled();

    await models.settings.patch({ autoDetectColorScheme: true, darkTheme: 'one-dark' });
    await osChanges();
    expect(applyColorScheme).toHaveBeenCalledTimes(1);
    expect(applyColorScheme).toHaveBeenCalledWith(expect.objectContaining({ autoDetectColorScheme: true, darkTheme: 'one-dark' }));
  });
});
