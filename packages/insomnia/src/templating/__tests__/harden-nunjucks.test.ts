import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as templating from '../index';

jest.mock('electron');

describe('template lookups', () => {
  beforeEach(globalBeforeEach);

  it('still reads variables, members and methods', async () => {
    const context = { foo: { bar: 'baz' }, arr: [{ prop: 1 }], 'dash-name': 'x', s: 'abc' };
    const rendered = await templating.render(
      '{{ foo.bar }} {{ arr[0].prop }} {{ _["dash-name"] }} {{ s.length }} {{ s.toUpperCase() }}',
      { context },
    );
    expect(rendered).toBe('baz 1 x 3 ABC');
  });

  it.each([
    '{{ foo.constructor }}',
    '{{ foo["constructor"] }}',
    '{{ foo.__proto__ }}',
    '{{ arr.prototype }}',
    '{{ range.constructor }}',
    '{{ constructor }}',
  ])('refuses %s', async template => {
    await expect(templating.render(template, { context: { foo: {}, arr: [] } })).rejects.toThrow();
  });
});
