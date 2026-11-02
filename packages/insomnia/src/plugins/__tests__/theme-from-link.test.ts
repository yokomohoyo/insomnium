import { describe, expect, it } from '@jest/globals';

import { generateThemeCSS, themeFromLink } from '../misc';

describe('themeFromLink()', () => {
  it('keeps the colors, and no raw CSS', () => {
    const theme = themeFromLink({
      name: 'sunset',
      displayName: 'Sunset',
      extra: 'dropped',
      theme: {
        rawCss: 'input[value^="a"] { background: url(https://example.com/a) }',
        background: { default: '#222', success: 'url(https://example.com/x)', info: 'rgb(1, 2, 3)' },
        foreground: { success: '#fff' },
        styles: { sidebar: { highlight: { default: 'red', sm: { nested: true } } }, made_up: { background: { default: '#000' } } },
      },
    });
    expect(theme).toEqual({
      name: 'sunset',
      displayName: 'Sunset',
      theme: {
        background: { default: '#222', info: 'rgb(1, 2, 3)' },
        styles: { sidebar: { highlight: { default: 'red' } } },
      },
    });
    expect(generateThemeCSS(theme)).not.toContain('example.com');
  });

  it('makes do with a link that has no theme', () => {
    expect(themeFromLink({ name: 'bare' })).toEqual({ name: 'bare', displayName: 'bare', theme: {} });
  });
});
