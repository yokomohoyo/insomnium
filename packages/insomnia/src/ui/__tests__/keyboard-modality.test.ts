import { describe, expect, it } from '@jest/globals';
import { fireEvent } from '@testing-library/react';

import { trackKeyboardModality } from '../keyboard-modality';

describe('trackKeyboardModality', () => {
  it('marks the keyboard in use from a key until the pointer is used', () => {
    const root = document.createElement('div');
    const stop = trackKeyboardModality(root);
    try {
      fireEvent.keyDown(document.body, { key: 'Tab' });
      expect(root.hasAttribute('data-keyboard')).toBe(true);

      fireEvent.pointerDown(document.body);
      expect(root.hasAttribute('data-keyboard')).toBe(false);

      // a shortcut or a modifier alone isn't moving around
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 'Shift' });
      expect(root.hasAttribute('data-keyboard')).toBe(false);

      fireEvent.keyDown(document.body, { key: 'ArrowDown' });
      expect(root.hasAttribute('data-keyboard')).toBe(true);
    } finally {
      stop();
    }
  });
});
