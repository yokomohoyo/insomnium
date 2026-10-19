import { afterEach, describe, expect, it } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { setLanguage } from '../../common/i18n';
import { tx } from '../tx';

describe('tx', () => {
  afterEach(() => setLanguage('en'));

  it('puts the elements where the translation has them', () => {
    const link = <a href="https://example.com">docs</a>;
    expect(renderToStaticMarkup(tx('See the {link}.', { link }))).toBe('See the <a href="https://example.com">docs</a>.');
    setLanguage('ja');
    expect(renderToStaticMarkup(tx('See the {link}.', { link }))).toBe('<a href="https://example.com">docs</a>を参照してください。');
  });

  it('fills in values, and leaves a brace it has nothing for as it is', () => {
    expect(renderToStaticMarkup(tx("It didn't load: {error}", {}, { error: '{boom}' }))).toBe('It didn&#x27;t load: {boom}');
    expect(renderToStaticMarkup(tx('Do you want to install {name}?', { name: <code>x</code> }))).toBe('Do you want to install <code>x</code>?');
  });
});
