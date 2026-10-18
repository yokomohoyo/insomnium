import { describe, expect, it } from '@jest/globals';

import { MAX_OPEN_TABS, neighborOf, withoutTab, withTab } from '../open-tabs';

describe('open tabs', () => {
  it('adds a request at the end, once', () => {
    expect(withTab(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(withTab(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });

  it('lets the oldest go when there are too many', () => {
    const open = Array.from({ length: MAX_OPEN_TABS }, (_, index) => `req_${index}`);

    expect(withTab(open, 'new')).toEqual([...open.slice(1), 'new']);
    expect(withTab(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('closes one', () => {
    expect(withoutTab(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(withoutTab(['a'], 'z')).toEqual(['a']);
  });

  it('shows the next tab when one closes, or else the one before', () => {
    expect(neighborOf(['a', 'b', 'c'], 'b')).toBe('c');
    expect(neighborOf(['a', 'b', 'c'], 'c')).toBe('b');
    expect(neighborOf(['a'], 'a')).toBeUndefined();
    expect(neighborOf(['a'], 'z')).toBeUndefined();
  });
});
