import { describe, expect, it } from '@jest/globals';
import { act, render, within } from '@testing-library/react';
import React, { createRef } from 'react';

import { AboutModal, type AboutModalHandle, aboutText } from '../modals/about-modal';

const details = {
  productName: 'Insomnium',
  version: '0.7.4',
  rows: [['Electron', '43.0.0'], ['Architecture', 'x64']] as [string, string][],
};

describe('the About dialog', () => {
  it('shows the app, its version, the tagline and the build details', () => {
    const ref = createRef<AboutModalHandle>();
    const view = render(<AboutModal ref={ref} />);
    act(() => ref.current?.show(details));

    expect(view.getByRole('heading', { name: 'Insomnium' })).toBeTruthy();
    expect(view.getByText('Version 0.7.4')).toBeTruthy();
    expect(view.getByText('A 100% local and privacy-focused fork of Insomnia')).toBeTruthy();
    const list = view.getByLabelText('Build details');
    expect(within(list).getByText('Electron')).toBeTruthy();
    expect(within(list).getByText('43.0.0')).toBeTruthy();
  });

  it('copies the details as plain text', () => {
    expect(aboutText(details)).toBe('Insomnium 0.7.4\nElectron: 43.0.0\nArchitecture: x64');
  });
});
