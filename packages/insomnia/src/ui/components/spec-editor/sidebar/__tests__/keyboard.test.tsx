import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';

import { SidebarBadge } from '../sidebar-badge';
import { SidebarHeader } from '../sidebar-header';
import { SidebarItem } from '../sidebar-item';

describe('the Design outline from the keyboard', () => {
  it('opens an item with Enter or Space', () => {
    const onClick = jest.fn();
    const view = render(<SidebarItem onClick={onClick}>title</SidebarItem>);
    const item = view.getByRole('button', { name: 'title' });
    expect(item.tabIndex).toBe(0);
    fireEvent.keyDown(item, { key: 'Enter' });
    fireEvent.keyDown(item, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('leaves an item with nothing to open out of the tab order', () => {
    const view = render(<SidebarItem>just text</SidebarItem>);
    expect(view.queryByRole('button')).toBeNull();
  });

  it("opens a path's method from its badge", () => {
    const onClick = jest.fn();
    const view = render(<SidebarBadge method="get" onClick={onClick} />);
    fireEvent.keyDown(view.getByRole('button', { name: 'get' }), { key: 'Enter' });
    expect(onClick).toHaveBeenCalled();
  });

  it('expands a section, and filters it without toggling it', () => {
    const toggleSection = jest.fn();
    const toggleFilter = jest.fn();
    const view = render(<SidebarHeader headerTitle="PATHS" sectionVisible toggleSection={toggleSection} toggleFilter={toggleFilter} />);
    const header = view.getByRole('button', { name: /PATHS/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(toggleSection).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(view.getByRole('button', { name: 'Filter' }), { key: 'Enter' });
    expect(toggleFilter).toHaveBeenCalledTimes(1);
    expect(toggleSection).toHaveBeenCalledTimes(1);
  });
});
