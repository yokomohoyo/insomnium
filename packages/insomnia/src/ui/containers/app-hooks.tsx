import { FC, useEffect } from 'react';

import { useGlobalKeyboardShortcuts } from '../hooks/use-global-keyboard-shortcuts';
import { useSettingsSideEffects } from '../hooks/use-settings-side-effects';

import { useThemeChange } from '../hooks/use-theme-change';

export const AppHooks: FC = () => {

  useSettingsSideEffects();
  useGlobalKeyboardShortcuts();
  useThemeChange();
  // Tells main the 'shell:open' listener is up, so it can send insomnia:// links that launched the app
  useEffect(() => {
    setTimeout(() => window.main.halfSecondAfterAppStart(), 500);
  }, []);

  return null;
};
