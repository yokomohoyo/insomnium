import { describe, expect, it } from '@jest/globals';
import { act, render } from '@testing-library/react';
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
});
