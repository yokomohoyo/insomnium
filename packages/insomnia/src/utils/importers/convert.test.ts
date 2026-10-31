import { describe, expect, it } from '@jest/globals';
import { fail } from 'assert';

import { convert } from './convert';

describe('Import errors', () => {
  it('fail to find importer', async () => {
    try {
      await convert('foo');
      fail('Should have thrown error');
    } catch (err) {
      expect(err.message).toBe("It isn't in a format the app can import");
    }
  });
});
