import { describe, expect, it } from '@jest/globals';

import { visualizationDocument } from '../visualizer';

describe('visualizationDocument()', () => {
  const page = visualizationDocument({ template: '<p>{{name}}</p></script><script>alert(1)</script>', data: { name: '</script><img src=x onerror=alert(2)>', line: 'a\u2028b' } }, 'var Handlebars = {}; // </script> in the runtime');

  it('keeps everything the page shows in its own policy, without the network', () => {
    expect(page).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">`);
  });

  it("can't be broken out of by the template, the data or the runtime", () => {
    const scripts = page.split('</script>');
    // WebRTC's removal, the runtime's, the renderer's, and the end of the last
    expect(scripts).toHaveLength(4);
    expect(page).toContain("Object.defineProperty(window, name, { value: undefined");
    expect(page).toContain('"\\u003cp>{{name}}\\u003c/p>\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"');
    expect(page).toContain('\\u003c/script>\\u003cimg src=x onerror=alert(2)>');
    expect(page).toContain('"line":"a\\u2028b"');
    expect(page).toContain('// <\\/script> in the runtime');
  });
});
