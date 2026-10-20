import { describe, expect, it } from '@jest/globals';

import { getAppDefaultDarkTheme, getAppDefaultLightTheme, getAppDefaultTheme } from '../../common/constants';
import { init, migrateFollowOsColorScheme, type Settings } from '../settings';

// a settings doc as an install from before 0.5 has it: the theme fields, and no marker
const before = (patch: Partial<Settings> = {}) => ({
  ...init(),
  autoDetectColorScheme: false,
  autoDetectColorSchemeDefaulted: false,
  ...patch,
} as Settings);

describe("following the OS's light or dark", () => {
  it('is on out of the box', () => {
    expect(init().autoDetectColorScheme).toBe(true);
    expect(migrateFollowOsColorScheme(init() as Settings).autoDetectColorScheme).toBe(true);
  });

  it('is turned on, once, for an install still on the out-of-the-box theme', () => {
    const migrated = migrateFollowOsColorScheme(before());
    expect(migrated).toMatchObject({ autoDetectColorScheme: true, autoDetectColorSchemeDefaulted: true });
    expect(migrated.theme).toBe(getAppDefaultTheme());
    expect(migrated.lightTheme).toBe(getAppDefaultLightTheme());
    expect(migrated.darkTheme).toBe(getAppDefaultDarkTheme());
  });

  it('leaves a theme someone chose', () => {
    expect(migrateFollowOsColorScheme(before({ theme: 'one-dark' })).autoDetectColorScheme).toBe(false);
    expect(migrateFollowOsColorScheme(before({ lightTheme: 'solarized-light' })).autoDetectColorScheme).toBe(false);
  });

  it('stays off when turned off after', () => {
    const off = { ...migrateFollowOsColorScheme(before()), autoDetectColorScheme: false };
    expect(migrateFollowOsColorScheme(off).autoDetectColorScheme).toBe(false);
  });
});
