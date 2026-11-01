/**
 * npm run bench -- spec
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { parseApiSpec } from '../common/api-specs';
import { lintSpec } from '../main/spectral-lint';
import { largeOpenApi } from './fixtures';
import { median, report } from './seed';

describe('a large OpenAPI spec', () => {
  for (const [paths, format] of [[2000, 'json'], [500, 'yaml']] as const) {
    it(`${paths} paths, ${format}`, async () => {
      const contents = largeOpenApi(paths, format);
      const mb = (contents.length / 1024 / 1024).toFixed(1);
      report(`parseApiSpec, ${mb} MB ${format}`, await median(() => parseApiSpec(contents), 3));

      // as the Spec tab's loader, then its editor, lint the text after an edit
      let start = performance.now();
      const first = await lintSpec({ contents });
      report(`lint, ${mb} MB ${format}`, performance.now() - start);
      start = performance.now();
      const second = await lintSpec({ contents });
      report(`lint the same text again, ${mb} MB ${format}`, performance.now() - start);
      expect(second).toBe(first);
    }, 120_000);
  }
});
