import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import realPath from 'path';

import { convertToOsSep, convertToPosixSep } from '../path-sep';

jest.mock('path');

// the mock (__mocks__/path.ts) adds __mockPath, and the tests pick a flavour by name
const path = realPath as typeof realPath & { __mockPath(type: string): void } & Record<string, typeof realPath>;

describe('convertToPosixSep()', () => {
  it('should handle empty string', () => {
    expect(convertToPosixSep('')).toBe('');
  });

  it.each(['win32', 'posix'])('should convert separator from %s to posix', type => {
    const input = path[type].join('a', 'b', 'c');
    const posix = path.posix.join('a', 'b', 'c');
    expect(convertToPosixSep(input)).toBe(posix);
  });
});

describe.each(['win32', 'posix'])('convertToOsSep() where os is %s', osType => {
  beforeAll(() => path.__mockPath(osType));

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it.each(['win32', 'posix'])(`should convert separators from %s to ${osType}`, inputType => {
    const input = path[inputType].join('a', 'b', 'c');
    const output = path[osType].join('a', 'b', 'c');
    expect(convertToOsSep(input)).toBe(output);
  });
});
