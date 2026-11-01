import { describe, expect, it } from '@jest/globals';

import { assertDataOnlyRuleset } from '../spectral-ruleset';

describe('assertDataOnlyRuleset', () => {
  it.each([
    'rules: {}',
    'extends: spectral:oas',
    'extends: [[spectral:oas, recommended]]',
    [
      'extends: [spectral:oas, spectral:asyncapi]',
      'rules:',
      '  info-contact: off',
      '  my-rule:',
      '    given: $.info',
      '    then: { field: title, function: truthy }',
      'overrides:',
      '  - files: ["*.yaml"]',
      '    rules: { my-rule: off }',
    ].join('\n'),
  ])('accepts %j', source => {
    expect(() => assertDataOnlyRuleset(source)).not.toThrow();
  });

  it.each([
    'functions: [myFunc]',
    'functionsDir: ./functions',
    'extends: ./other.yaml',
    'extends: https://example.com/ruleset.yaml',
    'extends: "@stoplight/spectral-owasp-ruleset"',
    'extends: [[./other.js, all]]',
    'overrides: [{ files: ["*"], functions: [myFunc] }]',
    'overrides: [{ files: ["*"], extends: ./other.yaml }]',
    '<<: {functionsDir: fns, functions: [pwn]}\nrules: {}',
    '<<: {extends: ./evil.js}',
    'base: &base {functions: [pwn]}\n<<: *base',
    'overrides: [{ files: ["*"], <<: {functions: [pwn]} }]',
    'rules: {r: {<<: {given: $}}}',
    '- not an object',
    '',
  ])('rejects %j', source => {
    expect(() => assertDataOnlyRuleset(source)).toThrow();
  });
});
