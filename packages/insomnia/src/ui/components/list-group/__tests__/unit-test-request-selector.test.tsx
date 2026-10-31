import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import React from 'react';

import { SidebarFilter } from '../../spec-editor/sidebar/sidebar-filter';
import { UnitTestRequestSelector } from '../unit-test-request-selector';

describe('unlabelled controls', () => {
  it("names a unit test's request picker", () => {
    const view = render(<UnitTestRequestSelector onSetActiveRequest={jest.fn()} selectableRequests={[]} />);
    expect(view.getByRole('combobox', { name: 'Request' })).toBeTruthy();
  });

  it("names the Design outline's filter", () => {
    const view = render(<SidebarFilter filter onChange={jest.fn()} />);
    expect(view.getByRole('textbox', { name: 'Filter' })).toBeTruthy();
  });
});
