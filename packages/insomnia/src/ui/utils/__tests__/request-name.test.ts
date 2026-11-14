import { describe, expect, it } from '@jest/globals';

import { requestDisplayName } from '../request-name';

describe('requestDisplayName', () => {
  it('uses the name when there is one', () => {
    expect(requestDisplayName({ name: 'List pets', url: 'http://localhost:4010/pets' })).toBe('List pets');
  });

  it('falls back to the URL of a nameless request', () => {
    expect(requestDisplayName({ name: '', url: 'http://localhost:4010/pets' })).toBe('http://localhost:4010/pets');
  });

  it('says so when there is neither', () => {
    expect(requestDisplayName({ name: '', url: '' })).toBe('Untitled request');
  });
});
