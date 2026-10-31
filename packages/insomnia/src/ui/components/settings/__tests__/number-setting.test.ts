import { describe, expect, it } from '@jest/globals';

import { snapNumberToLimits } from '../number-setting';

describe('snapNumberToLimits', () => {
  it('keeps a number at or above a minimum of 0, as for the request timeout', () => {
    expect(snapNumberToLimits(-5, 0)).toBe(0);
    expect(snapNumberToLimits(0, 0)).toBe(0);
    expect(snapNumberToLimits(250, 0)).toBe(250);
  });

  it('keeps a number within its limits', () => {
    expect(snapNumberToLimits(0, 8, 24)).toBe(8);
    expect(snapNumberToLimits(99, 8, 24)).toBe(24);
    expect(snapNumberToLimits(-3, -1)).toBe(-1);
    expect(snapNumberToLimits(-1, -1)).toBe(-1);
  });

  it('takes a maximum of 0 as a limit too', () => {
    expect(snapNumberToLimits(5, -10, 0)).toBe(0);
  });

  it('ignores limits that are not numbers', () => {
    expect(snapNumberToLimits(-5, NaN, NaN)).toBe(-5);
    expect(snapNumberToLimits(500)).toBe(500);
  });
});
