import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import { jsonPrettify } from './json';

describe('jsonPrettify()', () => {
  const basePath = path.join(__dirname, './fixtures');
  const files = fs.readdirSync(basePath);
  for (const file of files) {
    if (!file.match(/-input\.json$/)) {
      continue;
    }

    const slug = file.replace(/-input\.json$/, '');
    const name = slug.replace(/-/g, ' ');

    it(`handles ${name}`, () => {
      const input = fs.readFileSync(path.join(basePath, `${slug}-input.json`), 'utf8').trim();
      const output = fs.readFileSync(path.join(basePath, `${slug}-output.json`), 'utf8').trim();
      const result = jsonPrettify(input, '  ');
      expect(result).toBe(output);
    });
  }

  // as the character-at-a-time version gave them
  it.each([
    ['{"a":"x\\"y","b":"\\\\"}', '{\n  "a": "x\\"y",\n  "b": "\\\\"\n}'],
    ['"ends in \\', '"ends in \\'],
    ['{"a":[1,2', '{\n  "a": [\n    1,\n    2'],
    ['{"a":{{ v }},"b":{% tag %},"c":{# note #}3}', '{\n  "a": {{ v }},\n  "b": {% tag %},\n  "c": {# note #}\n  3\n}'],
    ['[ ]', '[\n]'],
    ['{"a":-1.50e+3,"b":true,"c":null}', '{\n  "a": -1.50e+3,\n  "b": true,\n  "c": null\n}'],
  ])('keeps %j as it was', (input, output) => {
    expect(jsonPrettify(input, '  ')).toBe(output);
  });
});
