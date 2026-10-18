/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { lintSpec } from '../spectral-lint';

const spec = `openapi: 3.0.0
info:
  title: Pets
  version: 1.0.0
paths: {}
`;

const codes = (diagnostics: { code: string | number }[]) => diagnostics.map(({ code }) => code);

describe('lintSpec()', () => {
  let dir: string;
  const ruleset = (name: string, source: string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, source);
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectral-lint-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lints with the built-in OpenAPI rules', async () => {
    expect(codes(await lintSpec({ contents: spec }))).toContain('info-contact');
  });

  it("lints with a ruleset's own rules", async () => {
    const rulesetPath = ruleset('.spectral.yaml', 'extends: spectral:oas\nrules:\n  info-contact: off\n');

    const diagnostics = await lintSpec({ contents: spec, rulesetPath });

    expect(codes(diagnostics)).not.toContain('info-contact');
    expect(codes(diagnostics)).not.toContain('ruleset');
  });

  it.each([
    ['one with custom functions', 'functions: [myFunc]\n', 'custom functions are not supported'],
    ['one that extends a file', 'extends: ./other.yaml\n', 'can only extend built-in rulesets'],
    ['a file that is gone', undefined, 'ENOENT'],
  ])("says so, and lints with the built-in rules, when the ruleset is %s", async (_, source, problem) => {
    const rulesetPath = source === undefined ? path.join(dir, 'gone.yaml') : ruleset('rules.yaml', source);

    const [first, ...rest] = await lintSpec({ contents: spec, rulesetPath });

    expect(first).toMatchObject({ code: 'ruleset', severity: 1, range: { start: { line: 0, character: 0 } } });
    expect(first.message).toContain(`${path.basename(rulesetPath)} couldn't be used, so the built-in rules apply:`);
    expect(first.message).toContain(problem);
    expect(codes(rest)).toContain('info-contact');
  });
});
