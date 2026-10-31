import Color from 'color';

import type { ThemeBlock } from './misc';

// Electron's nativeTheme colours the parts of the window the app doesn't draw:
// the title bar and menu bar on Windows and Linux, context menus, scroll bars,
// and the frame on macOS. Left alone it follows the OS, so a dark theme on a
// light desktop got a light menu bar.
export type NativeThemeSource = 'system' | 'light' | 'dark';

// When the theme follows the OS this does too: a forced one would hide the
// OS's changes from prefers-color-scheme, which is how the app sees them.
export function nativeThemeSourceFor(theme: { theme: object } | undefined, followSystem: boolean): NativeThemeSource {
  if (followSystem) {
    return 'system';
  }
  return colorSchemeFor(theme) || 'system';
}

// whether a theme is dark or light, from its background, or undefined when it
// can't be read. The page's color-scheme takes it, so the controls the browser
// draws (checkboxes, number spinners, scroll bars, select lists) match the
// theme: without one they're always light
export function colorSchemeFor(theme: { theme: object } | undefined): 'dark' | 'light' | undefined {
  if (!theme) {
    return undefined;
  }
  const { background } = theme.theme as ThemeBlock;
  try {
    // a theme without a background gets the base theme's white
    return Color(background?.default || '#fff').isDark() ? 'dark' : 'light';
  } catch {
    return undefined;
  }
}
