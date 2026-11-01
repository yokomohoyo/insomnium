/**
 * npm run bench -- import-convert
 * @jest-environment node
 */
import { describe, it } from '@jest/globals';

import { convert } from '../utils/importers/convert';
import { largeOpenApi } from './fixtures';
import { median, report } from './seed';

// every import (and generating requests from a spec) tries the importers in turn
describe('converting a large spec (import, generate requests)', () => {
  for (const format of ['yaml', 'json'] as const) {
    it(`2000 paths, ${format}`, async () => {
      const contents = largeOpenApi(2000, format);
      const mb = (contents.length / 1024 / 1024).toFixed(1);
      report(`convert, ${mb} MB ${format}`, await median(() => convert(contents), 3));
    }, 300_000);
  }
});
