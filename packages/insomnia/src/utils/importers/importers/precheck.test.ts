/*
* @jest-environment node
*/
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import YAML from 'yaml';

import { convert } from '../convert';
import { convert as convert4 } from './insomnia-4';
import { convert as convert5 } from './insomnia-5';
import { convert as convertSwagger2 } from './swagger-2';

const spec = `openapi: 3.0.0
info:
  title: Pets
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List pets
`;

describe('the Insomnia v4 and v5 importers, and the Swagger 2.0 one', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("don't parse a file that can't be theirs", async () => {
    const parse = jest.spyOn(YAML, 'parse');

    expect(convert4(spec)).toBeNull();
    expect(convert5(spec)).toBeNull();
    expect(await convertSwagger2(spec)).toBeNull();

    expect(parse).not.toHaveBeenCalled();
    // which another importer takes
    expect((await convert(spec)).type.id).toBe('openapi3');
  });

  it('take their own, in YAML or JSON, a / escaped too', async () => {
    const v4 = JSON.stringify({ _type: 'export', __export_format: 4, resources: [{ _id: 'wrk_1', _type: 'workspace', name: 'Four' }] });
    const v5 = '{"type": "collection.insomnia.rest\\/5.0", "name": "Five", "meta": {"id": "wrk_5"}, "collection": []}';

    expect((await convert(v4)).type.id).toBe('insomnia-4');
    expect((await convert(v5)).type.id).toBe('insomnia-5');
    expect(convert5(v5)).toEqual(expect.arrayContaining([expect.objectContaining({ _type: 'workspace', name: 'Five' })]));
    expect((await convert('swagger: "2.0"\ninfo: {title: Two, version: "1"}\npaths: {}\n')).type.id).toBe('swagger2');
  });
});
