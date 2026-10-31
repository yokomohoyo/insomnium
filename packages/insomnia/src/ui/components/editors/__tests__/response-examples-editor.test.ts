import { describe, expect, it } from '@jest/globals';

import { statusCodeFrom } from '../response-examples-editor';

describe('statusCodeFrom()', () => {
  it('takes a status an HTTP server can send', () => {
    expect(statusCodeFrom('200')).toBe(200);
    expect(statusCodeFrom('100')).toBe(100);
    expect(statusCodeFrom('599')).toBe(599);
  });

  it("refuses one it can't, or what isn't a number", () => {
    expect(statusCodeFrom('9999')).toBeNull();
    expect(statusCodeFrom('99')).toBeNull();
    expect(statusCodeFrom('20.5')).toBeNull();
    expect(statusCodeFrom('')).toBeNull();
    expect(statusCodeFrom('ok')).toBeNull();
  });
});
