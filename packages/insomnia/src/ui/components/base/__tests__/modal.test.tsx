import { describe, expect, it, jest } from '@jest/globals';
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

  it('closes once for a click on its close button, with the onHide it has now', () => {
    const ref = createRef<ModalHandle>();
    // a parent's new onHide on each of its renders, as an inline arrow is
    const onHides = [jest.fn(), jest.fn(), jest.fn()];
    const view = render(<Modal ref={ref} onHide={onHides[0]}><ModalHeader>Again</ModalHeader></Modal>);
    act(() => ref.current?.show());
    for (const onHide of onHides.slice(1)) {
      view.rerender(<Modal ref={ref} onHide={onHide}><ModalHeader>Again</ModalHeader></Modal>);
    }

    fireEvent.click(view.getByRole('button', { name: 'Close dialog' }));

    expect(onHides.map(onHide => onHide.mock.calls.length)).toEqual([0, 0, 1]);
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
