import { describe, expect, it } from '@jest/globals';

import { restrictedIds } from '../restricted';

describe('restrictedIds()', () => {
  it('has what is marked, and everything in a marked folder, however deep', () => {
    const collection = [
      { doc: { _id: 'fld_admin', securityRestricted: true }, ancestors: [] },
      { doc: { _id: 'fld_reports' }, ancestors: ['fld_admin'] },
      { doc: { _id: 'req_revenue' }, ancestors: ['fld_admin', 'fld_reports'] },
      { doc: { _id: 'fld_public' }, ancestors: [] },
      { doc: { _id: 'req_products' }, ancestors: ['fld_public'] },
      { doc: { _id: 'req_settings', securityRestricted: true }, ancestors: ['fld_public'] },
      { doc: { _id: 'req_health' } },
    ];

    expect([...restrictedIds(collection)]).toEqual(['fld_admin', 'fld_reports', 'req_revenue', 'req_settings']);
  });

  it('is empty when nothing is marked', () => {
    expect(restrictedIds([{ doc: { _id: 'req_1' }, ancestors: ['fld_1'] }]).size).toBe(0);
  });
});
