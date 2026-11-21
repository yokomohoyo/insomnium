/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { longestStallDuring } from '../../__jest__/proto-worker';
import { largeOpenApi } from '../../__perf__/fixtures';
import { petstoreExample } from '../../common/petstore-example';
import { lintSpec } from '../spectral-lint';

// Spectral runs on its worker thread, here from its TypeScript source
jest.mock('worker_threads', () => (jest.requireActual('../../__jest__/spectral-worker') as { workerThreads: unknown }).workerThreads);

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

  it('finds nothing wrong with the example a design document starts from', async () => {
    expect(codes(await lintSpec({ contents: petstoreExample }))).toEqual([]);
  });

  it('lints an AsyncAPI document with the built-in AsyncAPI rules', async () => {
    const asyncApi = 'asyncapi: 2.6.0\ninfo:\n  title: Lights\n  version: 1.0.0\nchannels: {}\n';

    const found = codes(await lintSpec({ contents: asyncApi }));

    expect(found).toContain('asyncapi-info-contact');
    expect(found).not.toContain('info-contact');
  });

  it('lints the same text with the same ruleset once', async () => {
    const rulesetPath = ruleset('.spectral.yaml', 'extends: spectral:oas\n');
    const contents = `${spec}# once\n`;

    const [first, second] = await Promise.all([lintSpec({ contents, rulesetPath }), lintSpec({ contents, rulesetPath })]);

    expect(second).toBe(first);
    expect(await lintSpec({ contents: `${contents}# changed\n`, rulesetPath })).not.toBe(first);
  });

  it('lints again once the ruleset has changed', async () => {
    const rulesetPath = ruleset('.spectral.yaml', 'extends: spectral:oas\n');
    const contents = `${spec}# ruleset changes\n`;
    expect(codes(await lintSpec({ contents, rulesetPath }))).toContain('info-contact');

    fs.writeFileSync(rulesetPath, 'extends: spectral:oas\nrules:\n  info-contact: off\n');

    expect(codes(await lintSpec({ contents, rulesetPath }))).not.toContain('info-contact');
  });

  it("lints with a ruleset's own rules", async () => {
    const rulesetPath = ruleset('.spectral.yaml', 'extends: spectral:oas\nrules:\n  info-contact: off\n');

    const diagnostics = await lintSpec({ contents: spec, rulesetPath });

    expect(codes(diagnostics)).not.toContain('info-contact');
    expect(codes(diagnostics)).not.toContain('ruleset');
  });

  it("keeps a ruleset's rule to the formats it names", async () => {
    const rule = (name: string, format: string) => `  ${name}:\n    given: $.info\n    formats: [${format}]\n    severity: warn\n    then: {field: summary, function: truthy}\n`;
    const rulesetPath = ruleset('.spectral.yaml', `rules:\n${rule('for-oas3', 'oas3')}${rule('for-oas2', 'oas2')}`);

    const diagnostics = await lintSpec({ contents: spec, rulesetPath });

    expect(codes(diagnostics)).toEqual(['for-oas3']);
  });

  it.each([
    ['one with custom functions', 'functions: [myFunc]\n', 'custom functions are not supported'],
    ['one that extends a file', 'extends: ./other.yaml\n', 'can only extend built-in rulesets'],
    ['one with custom functions merged in', '<<: {functionsDir: fns, functions: [pwn]}\nrules: {r: {given: "$", then: {function: pwn}}}\n', 'merge keys'],
    ['a file that is gone', undefined, 'ENOENT'],
  ])('says so, and lints with the built-in rules, when the ruleset is %s', async (_, source, problem) => {
    const rulesetPath = source === undefined ? path.join(dir, 'gone.yaml') : ruleset('rules.yaml', source);

    const [first, ...rest] = await lintSpec({ contents: spec, rulesetPath });

    expect(first).toMatchObject({ code: 'ruleset', severity: 1, range: { start: { line: 0, character: 0 } } });
    expect(first.message).toContain(`${path.basename(rulesetPath)} couldn't be used, so the built-in rules apply:`);
    expect(first.message).toContain(problem);
    expect(codes(rest)).toContain('info-contact');
  });

  describe('with the OWASP rules', () => {
    // served over http, with nothing to say who may call it
    const open = `${spec.replace('paths: {}\n', '')}servers:
  - url: http://api.example.com
paths:
  /pets/{id}:
    get:
      parameters:
        - {name: id, in: path, required: true, schema: {type: integer}}
      responses:
        '200': {description: OK}
`;
    const owaspCodes = (diagnostics: { code: string | number }[]) => codes(diagnostics).filter(code => String(code).startsWith('owasp:'));

    it('leaves them out unless asked', async () => {
      expect(owaspCodes(await lintSpec({ contents: open }))).toEqual([]);
    });

    it("adds their findings to the built-in rules', in the order of the document", async () => {
      const diagnostics = await lintSpec({ contents: open, owasp: true });

      expect(owaspCodes(diagnostics)).toEqual(expect.arrayContaining([
        'owasp:api1:2023-no-numeric-ids',
        'owasp:api8:2023-no-server-http',
      ]));
      expect(codes(diagnostics)).toContain('info-contact');
      const lines = diagnostics.map(({ range }) => range.start.line);
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
    });

    it("adds them to a ruleset file's rules too", async () => {
      const rulesetPath = ruleset('.spectral.yaml', 'extends: spectral:oas\nrules:\n  info-contact: off\n');

      const diagnostics = await lintSpec({ contents: open, rulesetPath, owasp: true });

      expect(codes(diagnostics)).not.toContain('info-contact');
      expect(owaspCodes(diagnostics)).toContain('owasp:api8:2023-no-server-http');
    });

    it('still says so when the ruleset file is no use', async () => {
      const [first, ...rest] = await lintSpec({ contents: open, rulesetPath: path.join(dir, 'gone.yaml'), owasp: true });

      expect(first.code).toBe('ruleset');
      expect(owaspCodes(rest)).toContain('owasp:api8:2023-no-server-http');
    });

    it('has nothing to say about an AsyncAPI document', async () => {
      const asyncApi = 'asyncapi: 2.6.0\ninfo:\n  title: Lights\n  version: 1.0.0\nchannels: {}\n';

      expect(await lintSpec({ contents: asyncApi, owasp: true })).toEqual(await lintSpec({ contents: asyncApi }));
    });
  });

  it('lints off the main thread, which keeps turning meanwhile', async () => {
    const contents = largeOpenApi(300, 'yaml');

    const { result, elapsed, longestStall } = await longestStallDuring(() => lintSpec({ contents }));

    expect(Array.isArray(result)).toBe(true);
    // the lint takes a while, but the main thread is never held up for it
    expect(longestStall).toBeLessThan(Math.max(100, elapsed / 4));
  }, 60_000);
});
