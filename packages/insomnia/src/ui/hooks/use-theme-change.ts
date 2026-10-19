import { useEffect } from 'react';

import * as models from '../../models';
import * as themes from '../../plugins/misc';

// Follows the OS's light or dark, when the settings say to. One listener, which
// reads the settings when it fires: the native theme follows the app's, so
// choosing a theme fires it too, and settings from an earlier render would put
// back the theme just left.
export const useThemeChange = () => {
  useEffect(() => {
    const matches = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = async () => {
      const settings = await models.settings.getOrCreate();
      if (settings.autoDetectColorScheme) {
        await themes.applyColorScheme(settings);
      }
    };
    matches.addEventListener('change', onChange);
    return () => {
      matches.removeEventListener('change', onChange);
    };
  }, []);
};
