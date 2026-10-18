import { describe, expect, it } from '@jest/globals';
import orderedJSON from 'json-order';

import { JSON_ORDER_PREFIX, JSON_ORDER_SEPARATOR } from '../../../../common/constants';
import { environmentFromRows, rowsFromEnvironment, VariableRow } from '../environment-variables';

const row = (name: string, value: string, type: VariableRow['type'] = 'text') => ({ id: name, name, value, type });
const withoutIds = (rows: VariableRow[]) => rows.map(({ id, ...rest }) => rest);

describe('environment variables as a table', () => {
  it('has a row for each top-level variable, in the saved order, keeping the type of what is not text', () => {
    const { object, map } = orderedJSON.parse('{"zeta": "z", "count": 3, "on": true, "api": {"host": "a.example.com"}, "list": ["a"]}', JSON_ORDER_PREFIX, JSON_ORDER_SEPARATOR);
    expect(withoutIds(rowsFromEnvironment({ object, propertyOrder: map || null }))).toEqual([
      { name: 'zeta', value: 'z', type: 'text' },
      { name: 'count', value: '3', type: 'json' },
      { name: 'on', value: 'true', type: 'json' },
      { name: 'api', value: '{"host":"a.example.com"}', type: 'json' },
      { name: 'list', value: '["a"]', type: 'json' },
    ]);
  });

  it('makes the environment back from the rows, in their order, as the JSON editor would save it', () => {
    const result = environmentFromRows([row('token', '{{ secret }}'), row('', 'skipped'), row('port', '8080', 'json'), row('flags', '{"beta": true}', 'json'), row('port_text', '8080')]);
    expect(result.info?.object).toEqual({ token: '{{ secret }}', port: 8080, flags: { beta: true }, port_text: '8080' });
    expect(Object.keys(result.info!.object)).toEqual(['token', 'port', 'flags', 'port_text']);
    // round trip
    expect(withoutIds(rowsFromEnvironment(result.info!))).toEqual([
      { name: 'token', value: '{{ secret }}', type: 'text' },
      { name: 'port', value: '8080', type: 'json' },
      { name: 'flags', value: '{"beta":true}', type: 'json' },
      { name: 'port_text', value: '8080', type: 'text' },
    ]);
  });

  it('says what is wrong with the rows', () => {
    expect(environmentFromRows([row('a', '1'), row('a', '2')]).error).toBe('"a" is in the table twice');
    expect(environmentFromRows([row('count', 'three', 'json')]).error).toBe('The value of "count" isn\'t JSON: write it in quotes, or make it Text');
    expect(environmentFromRows([row('$bad', 'x')]).error).toBe('"$bad" cannot begin with \'$\' or contain a \'.\'');
  });
});
