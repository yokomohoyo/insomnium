import { describe, expect, it } from '@jest/globals';

import { describeAssertion, evaluateAssertions, RequestAssertion } from '../assertions';

const response = {
  statusCode: 201,
  headers: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  elapsedTime: 123.4,
  body: JSON.stringify({ data: { id: 7, name: 'Rex', tags: ['a', 'b'] }, empty: null }),
};
const check = (assertion: Omit<RequestAssertion, 'id'>) => evaluateAssertions([{ id: 'a', ...assertion }], response)[0];

describe('evaluateAssertions()', () => {
  it.each([
    [{ source: 'status', operator: 'equals', value: '201' }],
    [{ source: 'status', operator: 'notEquals', value: '200' }],
    [{ source: 'status', operator: 'lessThan', value: '300' }],
    [{ source: 'header', property: 'content-type', operator: 'contains', value: 'json' }],
    [{ source: 'header', property: 'X-Missing', operator: 'notExists' }],
    [{ source: 'body', operator: 'contains', value: '"Rex"' }],
    [{ source: 'body', operator: 'notContains', value: 'secret' }],
    [{ source: 'jsonpath', property: '$.data.id', operator: 'equals', value: '7.0' }],
    [{ source: 'jsonpath', property: '$.data.name', operator: 'equals', value: 'Rex' }],
    [{ source: 'jsonpath', property: '$.data.tags', operator: 'equals', value: '["a","b"]' }],
    [{ source: 'jsonpath', property: '$.data.tags[*]', operator: 'contains', value: '"b"' }],
    [{ source: 'jsonpath', property: '$.empty', operator: 'exists' }],
    [{ source: 'jsonpath', property: '$.nope', operator: 'notExists' }],
    [{ source: 'responseTime', operator: 'lessThan', value: '1000' }],
    [{ source: 'responseTime', operator: 'greaterThan', value: '100' }],
  ] as [Omit<RequestAssertion, 'id'>][])('passes: %o', assertion => {
    expect(check(assertion)).toMatchObject({ passed: true, message: describeAssertion({ id: 'a', ...assertion }) });
  });

  it('fails with what it got', () => {
    expect(check({ source: 'status', operator: 'equals', value: '200' })).toEqual({
      id: 'a',
      passed: false,
      actual: '201',
      message: 'Status code equals 200: got "201"',
    });
    expect(check({ source: 'jsonpath', property: '$.nope', operator: 'equals', value: '1' }).message).toBe('JSON path $.nope equals 1: got nothing');
  });

  it('fails a number comparison on something that is not a number', () => {
    expect(check({ source: 'jsonpath', property: '$.data.name', operator: 'greaterThan', value: '1' }).passed).toBe(false);
    expect(check({ source: 'status', operator: 'lessThan', value: 'soon' }).passed).toBe(false);
  });

  it('explains a JSON path on a body that is not JSON, or with no path', () => {
    expect(evaluateAssertions([{ id: 'a', source: 'jsonpath', property: '$.a', operator: 'exists' }], { ...response, body: '<html>' })[0])
      .toMatchObject({ passed: false, message: 'JSON path $.a exists: the body is not JSON' });
    expect(check({ source: 'jsonpath', property: ' ', operator: 'exists' }).message).toMatch(/give the JSON path/);
    expect(check({ source: 'header', operator: 'exists' }).message).toMatch(/give the header name/);
  });

  // jsonpath-plus would read $[ as the whole body, which contains "Rex"
  it.each(['$[', '$]', '$.data[', "$['data", '$.data.'])('refuses a JSON path that is not whole: %s', property => {
    expect(check({ source: 'jsonpath', property, operator: 'contains', value: 'Rex' })).toMatchObject({
      passed: false,
      message: expect.stringContaining(`${property} isn't a whole JSON path`),
    });
  });

  it("reads the other quote in a JSON path's quotes as part of the name", () => {
    expect(evaluateAssertions([{ id: 'a', source: 'jsonpath', property: '$[\'say "hi"\']', operator: 'equals', value: '1' }], { ...response, body: '{"say \\"hi\\"":1}' })[0].passed).toBe(true);
  });

  it('skips disabled assertions, and fails everything on a response that never came', () => {
    expect(evaluateAssertions([{ id: 'a', disabled: true, source: 'status', operator: 'equals', value: '201' }], response)).toEqual([]);
    expect(evaluateAssertions([{ id: 'a', source: 'status', operator: 'exists' }], { body: '' })[0].passed).toBe(false);
  });

  it('shortens a long actual value', () => {
    const long = check({ source: 'body', operator: 'equals', value: 'x' });
    expect(evaluateAssertions([{ id: 'a', source: 'body', operator: 'equals', value: 'x' }], { body: 'y'.repeat(500) })[0].actual).toHaveLength(201);
    expect(long.passed).toBe(false);
  });
});
