import { describe, expect, it } from '@jest/globals';

import { colorSchemeFor, nativeThemeSourceFor } from '../native-theme';
import builtInThemes from '../themes';

describe('nativeThemeSourceFor', () => {
  it('makes the window dark for a dark theme and light for a light one', () => {
    for (const theme of builtInThemes) {
      const expected = /light/.test(theme.name) ? 'light' : /dark|default/.test(theme.name) ? 'dark' : undefined;
      if (expected) {
        expect([theme.name, nativeThemeSourceFor(theme, false)]).toEqual([theme.name, expected]);
      }
    }
  });

  it('follows the OS when the theme does', () => {
    expect(nativeThemeSourceFor(builtInThemes[0], true)).toBe('system');
  });

  it('takes the base white for a theme without a background', () => {
    expect(nativeThemeSourceFor({ theme: {} }, false)).toBe('light');
  });

  it('leaves the OS to it for a theme it cannot read', () => {
    expect(nativeThemeSourceFor(undefined, false)).toBe('system');
    expect(nativeThemeSourceFor({ theme: { background: { default: 'not a colour' } } }, false)).toBe('system');
  });
});

describe('colorSchemeFor', () => {
  it('gives the page a dark color-scheme for a dark theme and a light one for a light theme', () => {
    expect(colorSchemeFor(builtInThemes.find(({ name }) => name === 'default'))).toBe('dark');
    expect(colorSchemeFor(builtInThemes.find(({ name }) => name === 'light'))).toBe('light');
    expect(colorSchemeFor(undefined)).toBeUndefined();
  });
});
