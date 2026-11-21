/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { ignoredRules, SECURITY_RULES, securityRuleName, withoutIgnored } from '../security-rules';

const source = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('SECURITY_RULES', () => {
  it('names every rule a response is audited by', () => {
    const ids = [...source('response-audit.ts').matchAll(/^\s+id: '([a-z-]+)',$/gm)].map(match => match[1]);

    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter(id => !(id in SECURITY_RULES))).toEqual([]);
  });

  it('names every test that can find something', () => {
    const ids = [...source('security-tests.ts').matchAll(/await test\('([a-z-]+)'/g)].map(match => match[1]);

    expect(ids.length).toBeGreaterThan(5);
    expect(ids.filter(id => !(id in SECURITY_RULES))).toEqual([]);
  });

  it("has no rule that isn't one of those", () => {
    const sources = source('response-audit.ts') + source('security-tests.ts');

    expect(Object.keys(SECURITY_RULES).filter(id => !sources.includes(`'${id}'`))).toEqual([]);
  });
});

describe('ignoredRules()', () => {
  it('keeps the ids that are rules, once each', () => {
    expect(ignoredRules(['rate-limit', 'nosniff-missing', 'rate-limit', 'not-a-rule', 7, null])).toEqual(['rate-limit', 'nosniff-missing']);
  });

  it('is nothing for a setting that was never set', () => {
    expect(ignoredRules(undefined)).toEqual([]);
    expect(ignoredRules('rate-limit')).toEqual([]);
  });
});

describe('withoutIgnored()', () => {
  it('leaves out the findings of ignored rules', () => {
    const findings = [{ id: 'plain-http' }, { id: 'rate-limit' }, { id: 'plain-http' }];

    expect(withoutIgnored(findings, ['plain-http'])).toEqual([{ id: 'rate-limit' }]);
    expect(withoutIgnored(findings, [])).toBe(findings);
  });
});

describe('securityRuleName()', () => {
  it("is the rule's name, or its id when it has none", () => {
    expect(securityRuleName('rate-limit')).toBe('No sign of a rate limit');
    expect(securityRuleName('gone')).toBe('gone');
  });
});
