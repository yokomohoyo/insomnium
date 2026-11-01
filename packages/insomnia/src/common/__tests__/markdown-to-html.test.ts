import { describe, expect, it } from '@jest/globals';

import { markdownToHTML } from '../markdown-to-html';

describe('markdownToHTML()', () => {
  it('leaves out styles and scripts', () => {
    const html = markdownToHTML('# Orders\n\n<style>body { display: none }</style><p style="position: fixed">x</p><script>alert(1)</script>');
    expect(html).toContain('<h1');
    expect(html).not.toMatch(/<style|style=|<script/);
  });

  it("loads no remote image, keeping its alt text, and shows a data: one", () => {
    const html = markdownToHTML('![tracker](https://t.example.com/pixel.png) ![dot](data:image/png;base64,iVBORw0KGgo=)');
    expect(html).toContain('alt="tracker"');
    expect(html).not.toContain('t.example.com');
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    // and links still work
    expect(markdownToHTML('[docs](https://docs.example.com)')).toContain('href="https://docs.example.com"');
  });
});
