import { describe, expect, it } from '@jest/globals';

import { convert } from './insomnia-4';

describe('insomnia-4', () => {
  it("copies an Insomnia folder's scripts into the requests under it, which keep their own", async () => {
    const resources = await convert(JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Shop' },
        { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'Orders', description: 'Order endpoints', preRequestScript: "insomnia.environment.set('ts', Date.now());" },
        { _id: 'fld_2', _type: 'request_group', parentId: 'fld_1', name: 'Admin', afterResponseScript: "insomnia.test('ok', () => insomnia.expect(insomnia.response.code).to.equal(200));" },
        { _id: 'req_1', _type: 'request', parentId: 'fld_2', name: 'Refund', preRequestScript: "console.log('refund');" },
        { _id: 'req_2', _type: 'request', parentId: 'wrk_1', name: 'Health', afterResponseScript: 'console.log(1);' },
      ],
    })) || [];
    const byId = Object.fromEntries(resources.map(resource => [resource._id, resource]));

    expect(byId.req_1.preRequestScript).toBe([
      '// from Insomnia folder "Orders"',
      'await (async () => {',
      "insomnia.environment.set('ts', Date.now());",
      '})();',
      '',
      '// from this request',
      'await (async () => {',
      "console.log('refund');",
      '})();',
    ].join('\n'));
    expect(byId.req_1.afterResponseScript).toBe([
      '// from Insomnia folder "Admin"',
      'await (async () => {',
      "insomnia.test('ok', () => insomnia.expect(insomnia.response.code).to.equal(200));",
      '})();',
    ].join('\n'));
    expect(byId.req_2).toEqual({ _id: 'req_2', _type: 'request', parentId: 'wrk_1', name: 'Health', afterResponseScript: 'console.log(1);' });
    expect(byId.fld_1.description).toBe("Order endpoints\n\n**Insomnia pre-request script**, copied into each request under this folder, which runs it:\n\n```js\ninsomnia.environment.set('ts', Date.now());\n```");
  });
});
