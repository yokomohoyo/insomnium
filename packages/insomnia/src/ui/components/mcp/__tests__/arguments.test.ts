import { describe, expect, it } from '@jest/globals';

import { argsOf, argumentsSkeleton } from '../arguments';

describe('MCP request arguments', () => {
  it('reads a command argument from each line', () => {
    expect(argsOf('-y\n  @modelcontextprotocol/server-everything \n\n--port=3000\n')).toEqual(['-y', '@modelcontextprotocol/server-everything', '--port=3000']);
    expect(argsOf('')).toEqual([]);
  });

  it("starts a tool's arguments with an empty value of each type, the required ones first", () => {
    expect(JSON.parse(argumentsSkeleton({
      properties: { note: { type: 'string' }, count: { type: 'integer' }, tags: { type: 'array' }, on: { type: 'boolean' }, extra: { type: ['object', 'null'] } },
      required: ['count'],
    }))).toEqual({ count: 0, note: '', tags: [], on: false, extra: {} });
    expect(Object.keys(JSON.parse(argumentsSkeleton({ properties: { a: {}, b: {} }, required: ['b'] })))).toEqual(['b', 'a']);
    expect(argumentsSkeleton()).toBe('{}');
  });
});
