import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, '..', 'main.css'), 'utf8');

describe('keyboard focus', () => {
  it('draws a ring wherever focus is visible', () => {
    const rule = css.match(/:root :focus-visible[^{]*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/outline:\s*2px solid var\(--color-surprise\)/);
  });
});
