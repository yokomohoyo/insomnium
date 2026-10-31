import { describe, expect, it } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react';
import React, { createRef } from 'react';

import { Modal, type ModalHandle } from '../modal';
import { ModalHeader } from '../modal-header';

describe('<Modal />', () => {
  it('is a modal dialog named by its header, with a named close button', () => {
    const ref = createRef<ModalHandle>();
    const view = render(<Modal ref={ref}><ModalHeader>Rename Request</ModalHeader></Modal>);
    act(() => ref.current?.show());

    const dialog = view.getByRole('dialog', { name: 'Rename Request' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(view.getByRole('button', { name: 'Close dialog' })).toBeTruthy();
  });

  it('takes the focus, keeps Tab in it, and gives the focus back', async () => {
    const ref = createRef<ModalHandle>();
    const view = render(
      <>
        <button>behind</button>
        <Modal ref={ref}>
          <ModalHeader>Settings</ModalHeader>
          <button>first</button>
          <button>last</button>
        </Modal>
      </>
    );
    const behind = view.getByRole('button', { name: 'behind' });
    behind.focus();
    act(() => ref.current?.show());

    const dialog = view.getByRole('dialog', { name: 'Settings' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // the header's close button is first, the modal's last button last
    const close = view.getByRole('button', { name: 'Close dialog' });
    const last = view.getByRole('button', { name: 'last' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    act(() => ref.current?.hide());
    await act(() => new Promise(resolve => setTimeout(resolve)));
    expect(document.activeElement).toBe(behind);
  });
});
