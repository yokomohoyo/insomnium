// npm run bench -- json-prettify
import { describe, expect, it } from '@jest/globals';

import { jsonPrettify } from '../utils/prettify/json';
import { largeJson } from './fixtures';
import { median, report } from './seed';

describe('jsonPrettify (a JSON response, as the viewer shows it)', () => {
  for (const mb of [1, 4, 20]) {
    it(`${mb} MB`, async () => {
      const body = largeJson(mb * 1024 * 1024);
      const ms = await median(() => jsonPrettify(body, '  '), 3);
      report(`jsonPrettify, ${mb} MB`, ms);
      // for scale: parsing and printing it, which changes numbers and key order
      report(`  JSON.stringify(JSON.parse()), ${mb} MB`, await median(() => JSON.stringify(JSON.parse(body), null, '  '), 3));
      expect(jsonPrettify(body, '  ').length).toBeGreaterThan(body.length);
    }, 120_000);
  }
});
