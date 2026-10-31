import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react';
import React, { createRef } from 'react';

import { Dropdown, DropdownButton, type DropdownHandle, DropdownItem, ItemContent } from '..';

describe('a dropdown item', () => {
  it('that is disabled looks it and says so, and does nothing', async () => {
    const ref = createRef<DropdownHandle>();
    const stop = jest.fn();
    const settings = jest.fn();
    const view = render(
      <Dropdown ref={ref} aria-label="Workspace" triggerButton={<DropdownButton>Pets</DropdownButton>}>
        <DropdownItem aria-label="Stop Syncing">
          <ItemContent label="Stop Syncing" isDisabled onClick={stop} />
        </DropdownItem>
        <DropdownItem aria-label="Settings">
          <ItemContent label="Settings" onClick={settings} />
        </DropdownItem>
      </Dropdown>,
    );
    act(() => ref.current?.show());

    try {
      const disabled = view.getByRole('menuitem', { name: 'Stop Syncing' });
      expect(disabled.getAttribute('aria-disabled')).toBe('true');
      expect(getComputedStyle(disabled).opacity).toBe('0.5');
      fireEvent.click(disabled);
      expect(stop).not.toHaveBeenCalled();

      const enabled = view.getByRole('menuitem', { name: 'Settings' });
      expect(enabled.getAttribute('aria-disabled')).toBeNull();
      expect(getComputedStyle(enabled).opacity).toBe('1');
    } finally {
      // closed, and its focus handling done, before the document goes
      act(() => ref.current?.hide());
      view.unmount();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  });
});
