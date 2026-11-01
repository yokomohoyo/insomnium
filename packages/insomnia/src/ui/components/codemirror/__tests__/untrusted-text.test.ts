import { describe, expect, it } from '@jest/globals';

import { renderHintMatch } from '../extensions/autocomplete';
import { _updateElementText } from '../extensions/nunjucks-tags';

const HTML = '<img src=x onerror=alert(1)>';

describe('text from a collection in the editor', () => {
  it('is shown as text in an autocomplete entry', () => {
    const li = document.createElement('li');

    renderHintMatch(li, {} as any, { displayText: `api${HTML}`, segment: 'api', type: 'variable', displayValue: `x onmouseover=alert(1) ${HTML}` } as any);

    expect(li.querySelector('img')).toBeNull();
    expect(li.querySelector('.name')?.textContent).toBe(`api${HTML}`);
    expect(li.querySelector('.name strong')?.textContent).toBe('api');
    expect(li.querySelector('.value')?.getAttribute('title')).toBe(`x onmouseover=alert(1) ${HTML}`);
    expect(li.querySelector('.value')?.getAttributeNames()).toEqual(['class', 'title']);
  });

  it('is shown as text in a variable pill, value or not', async () => {
    for (const showVariableSourceAndValue of [false, true]) {
      const el = document.createElement('span');
      const mark = { replacedWith: el, changed: () => {} };
      const renderContext = async () => ({ context: { getKeysContext: () => ({ keyContext: {} }) } });

      await _updateElementText(async () => HTML, mark, `{{ ${HTML} }}`, renderContext, showVariableSourceAndValue);

      expect(el.querySelector('img')).toBeNull();
      expect(el.textContent).toBe(HTML);
    }
  });

  it('is shown as text when it fails to render', async () => {
    const el = document.createElement('span');
    const mark = { replacedWith: el, changed: () => {} };

    await _updateElementText(async () => {
      throw new Error('nope');
    }, mark, `{{ ${HTML} }}`, async () => ({}), false);

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('i.fa-exclamation-triangle')).not.toBeNull();
    expect(el.textContent).toBe(HTML);
  });
});
