import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { mayRunTests, trustTestCode } from '../test-code-trust';

describe('mayRunTests()', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('runs code written here without asking', () => {
    const confirm = jest.spyOn(window, 'confirm');
    trustTestCode(['expect(1).to.equal(1);']);

    expect(mayRunTests([{ name: 'mine', code: 'expect(1).to.equal(1);' }])).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks about code from elsewhere, once', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const imported = [{ name: 'Request A is found', code: "require('child_process')" }];

    expect(mayRunTests(imported)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('- Request A is found'));
    expect(mayRunTests(imported)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("doesn't run it, or trust it, when the answer is no", () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const imported = [{ name: 'x', code: 'evil()' }];

    expect(mayRunTests(imported)).toBe(false);
    expect(mayRunTests(imported)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('asks again once trusted code changes', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    trustTestCode(['a()']);

    expect(mayRunTests([{ name: 't', code: 'a(); evil()' }])).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
