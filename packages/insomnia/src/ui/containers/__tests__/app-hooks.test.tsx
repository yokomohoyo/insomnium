import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import React from 'react';

import { AppHooks } from '../app-hooks';

jest.mock('../../hooks/use-global-keyboard-shortcuts', () => ({ useGlobalKeyboardShortcuts: () => {} }));
jest.mock('../../hooks/use-settings-side-effects', () => ({ useSettingsSideEffects: () => {} }));
jest.mock('../../hooks/use-theme-change', () => ({ useThemeChange: () => {} }));

describe('<AppHooks />', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('tells main it is ready for links that launched the app', () => {
    jest.useFakeTimers();
    const halfSecondAfterAppStart = jest.fn();
    window.main = { halfSecondAfterAppStart } as unknown as Window['main'];

    render(<AppHooks />);
    expect(halfSecondAfterAppStart).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    expect(halfSecondAfterAppStart).toHaveBeenCalledTimes(1);
  });
});
