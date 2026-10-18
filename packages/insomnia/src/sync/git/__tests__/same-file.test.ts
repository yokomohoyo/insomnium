import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';

import * as models from '../../../models';
import { sameFile } from '../same-file';

const text = (value: unknown) => Buffer.from(typeof value === 'string' ? value : YAML.stringify(value));
const REQUEST = '.insomnium/Request/req_1.yml';

describe('sameFile()', () => {
  it('takes a request committed without the fields that have defaults now as the same as it is stored', async () => {
    // as an older client committed it
    const committed = { _id: 'req_1', type: 'Request', parentId: 'wrk_1', name: 'list pets', url: 'https://pets.example.com', modified: 1 };
    const stored = { ...await models.initModel(models.request.type, committed), modified: 2 };

    expect(await sameFile(REQUEST, text(committed), text(stored), '.insomnium')).toBe(true);
    expect(await sameFile(REQUEST, text(committed), text({ ...stored, name: 'list my pets' }), '.insomnium')).toBe(false);
  });

  it('takes a request moved in the list as changed, where both sides say where it goes', async () => {
    const doc = { _id: 'req_1', type: 'Request', parentId: 'wrk_1', name: 'list pets', metaSortKey: -1 };

    expect(await sameFile(REQUEST, text(doc), text({ ...doc, metaSortKey: -2 }), '.insomnium')).toBe(false);
    expect(await sameFile(REQUEST, text(doc), text(doc), '.insomnium')).toBe(true);
  });

  it('takes the same fields in another form as the same', async () => {
    const doc = { _id: 'req_1', type: 'Request', parentId: 'wrk_1', name: 'list pets' };

    expect(await sameFile(REQUEST, text(doc), text('{ name: "list pets", type: Request, _id: req_1, parentId: wrk_1 }\n'), '.insomnium')).toBe(true);
  });

  it('compares the repository\'s other files as they are, and a missing one only to a missing one', async () => {
    expect(await sameFile('package.json', text('{"a":1}'), text('{"a":1}'), '.insomnium')).toBe(true);
    expect(await sameFile('package.json', text('{"a":1}'), text('{ "a": 1 }'), '.insomnium')).toBe(false);
    expect(await sameFile(REQUEST, null, null, '.insomnium')).toBe(true);
    expect(await sameFile(REQUEST, null, text('_id: req_1'), '.insomnium')).toBe(false);
  });
});
