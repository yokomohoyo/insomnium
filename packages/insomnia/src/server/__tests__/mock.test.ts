import { describe, expect, it } from '@jest/globals';

import { parseMockConfig } from '../mock';

describe('parseMockConfig()', () => {
  it('reads the collections, port and host, with defaults from the environment', () => {
    expect(parseMockConfig(['--collection', 'a.yaml', '--collection', 'b.json'], {})).toEqual({ collections: ['a.yaml', 'b.json'], port: 4040, host: '127.0.0.1' });
    expect(parseMockConfig(['--collection', 'a.yaml', '--port', '8080', '--host', '0.0.0.0'], {})).toMatchObject({ port: 8080, host: '0.0.0.0' });
    expect(parseMockConfig(['--collection', 'a.yaml'], { INSOMNIUM_MOCK_PORT: '5000', INSOMNIUM_MOCK_HOST: '0.0.0.0' })).toMatchObject({ port: 5000, host: '0.0.0.0' });
  });

  it.each([
    [[], 'Give a collection to mock with --collection'],
    [['--collection'], '--collection needs a value'],
    [['--collection', 'a.yaml', '--port', 'abc'], '--port must be a port number'],
    [['--collection', 'a.yaml', '--verbose', 'x'], 'Unknown option --verbose'],
  ])('refuses %j', (argv, message) => {
    expect(() => parseMockConfig(argv as string[], {})).toThrow(message);
  });
});
