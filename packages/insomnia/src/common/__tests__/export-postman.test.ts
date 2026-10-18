import { describe, expect, it } from '@jest/globals';

import { convert as importPostman } from '../../utils/importers/importers/postman';
import { toPostmanCollection, toPostmanTemplate } from '../export-postman';

const resources = [
  { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Shop', description: 'The shop API' },
  { _id: 'env_1', _type: 'environment', parentId: 'wrk_1', name: 'Base Environment', data: { base_url: 'https://shop.example.com', retries: 3 } },
  { _id: 'env_2', _type: 'environment', parentId: 'env_1', name: 'Staging', data: { base_url: 'https://staging.example.com' } },
  { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'Orders', metaSortKey: 1, authentication: { type: 'bearer', token: '{{ _.token }}' } },
  {
    _id: 'req_1', _type: 'request', parentId: 'fld_1', name: 'Create order', metaSortKey: 1, method: 'POST',
    url: '{{ _.base_url }}/orders/:shop', segmentParams: [{ name: 'shop', value: 'main' }],
    parameters: [{ name: 'dry', value: 'true' }, { name: 'off', value: '1', disabled: true }],
    headers: [{ name: 'X-Trace', value: "{% faker 'randomUUID' %}" }],
    body: { mimeType: 'application/json', text: '{"item": "{{ item }}"}' },
    authentication: {},
    preRequestScript: "pm.variables.set('item', 'book');",
    afterResponseScript: "pm.test('created', () => pm.response.to.have.status(201));",
  },
  { _id: 'ex_1', _type: 'response_example', parentId: 'req_1', name: 'Created', statusCode: 201, statusMessage: 'Created', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"id": 1}' },
  {
    _id: 'req_2', _type: 'request', parentId: 'wrk_1', name: 'Sign in', metaSortKey: 2, method: 'POST', url: '{{ base_url }}/session',
    body: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'user', value: 'kim' }] },
    authentication: [{ type: 'basic', username: 'kim', password: '{{ password }}' }],
  },
  { _id: 'greq_1', _type: 'grpc_request', parentId: 'wrk_1', name: 'gRPC is left out' },
];

describe('toPostmanCollection()', () => {
  it("writes Postman's templates for Insomnium's variables and faker tags, and leaves other tags", () => {
    expect(toPostmanTemplate("{{ _.base_url }}/{{ id }}?t={% faker 'randomInt' %}&n={% now 'iso-8601' %}")).toBe("{{base_url}}/{{id}}?t={{$randomInt}}&n={% now 'iso-8601' %}");
  });

  it('makes a Postman collection: folders, requests, auth, bodies, scripts, examples and the base environment as variables', () => {
    const collection = toPostmanCollection(resources, 'Shop export');
    expect(collection.info).toEqual({ name: 'Shop', description: 'The shop API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' });
    expect(collection.variable).toEqual([{ key: 'base_url', value: 'https://shop.example.com' }, { key: 'retries', value: '3' }]);
    const [orders, signIn] = collection.item as any[];
    expect(orders).toMatchObject({ name: 'Orders', auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] } });
    expect(orders.item[0]).toEqual({
      name: 'Create order',
      request: {
        method: 'POST',
        header: [{ key: 'X-Trace', value: '{{$randomUUID}}' }],
        url: { raw: '{{base_url}}/orders/:shop?dry=true', query: [{ key: 'dry', value: 'true' }, { key: 'off', value: '1', disabled: true }], variable: [{ key: 'shop', value: 'main' }] },
        body: { mode: 'raw', raw: '{"item": "{{item}}"}', options: { raw: { language: 'json' } } },
      },
      event: [
        { listen: 'prerequest', script: { type: 'text/javascript', exec: ["pm.variables.set('item', 'book');"] } },
        { listen: 'test', script: { type: 'text/javascript', exec: ["pm.test('created', () => pm.response.to.have.status(201));"] } },
      ],
      response: [expect.objectContaining({ name: 'Created', code: 201, status: 'Created', header: [{ key: 'Content-Type', value: 'application/json' }], body: '{"id": 1}' })],
    });
    expect(signIn.request).toMatchObject({
      body: { mode: 'urlencoded', urlencoded: [{ key: 'user', value: 'kim' }] },
      auth: { type: 'basic', basic: [{ key: 'username', value: 'kim', type: 'string' }, { key: 'password', value: '{{password}}', type: 'string' }] },
    });
    expect(JSON.stringify(collection)).not.toContain('gRPC');
  });

  it('comes back the same through the Postman importer', async () => {
    const imported = await importPostman(JSON.stringify(toPostmanCollection(resources, 'Shop export'))) || [];
    const createOrder = imported.find(({ name }) => name === 'Create order');
    expect(createOrder).toMatchObject({
      method: 'POST',
      url: '{{base_url}}/orders/:shop',
      parameters: [{ name: 'dry', value: 'true', disabled: false }, { name: 'off', value: '1', disabled: true }],
      segmentParams: [expect.objectContaining({ name: 'shop', value: 'main' })],
      headers: [{ name: 'X-Trace', value: "{% faker 'randomUUID' %}" }],
      authentication: { type: 'bearer', token: '{{token}}' },
      preRequestScript: expect.stringContaining("pm.variables.set('item', 'book');"),
      afterResponseScript: expect.stringContaining("pm.test('created'"),
    });
    expect(imported.filter(({ _type }) => _type === 'response_example')).toEqual([expect.objectContaining({ name: 'Created', statusCode: 201, parentId: createOrder?._id })]);
    expect(imported.find(({ name }) => name === 'Sign in')).toMatchObject({ authentication: { type: 'basic', username: 'kim', password: '{{password}}' } });
  });

  it('puts each collection in a folder of its own when there are several', () => {
    const collection = toPostmanCollection([...resources, { _id: 'wrk_2', _type: 'workspace', parentId: null, name: 'Pets' }], 'Project');
    expect(collection.info.name).toBe('Project');
    expect((collection.item as any[]).map(({ name }) => name)).toEqual(['Shop', 'Pets']);
    expect(collection.variable).toBeUndefined();
  });
});

describe("a folder's headers", () => {
  it('go to each request under it, which Postman folders have no headers of their own', () => {
    const collection = toPostmanCollection([
      { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Shop' },
      { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'Orders', headers: [{ name: 'X-Tenant', value: 'acme' }, { name: 'Accept', value: 'application/json' }] },
      { _id: 'req_1', _type: 'request', parentId: 'fld_1', name: 'List', method: 'GET', url: 'https://shop.example.com/orders', headers: [{ name: 'accept', value: 'text/csv' }] },
    ] as any, 'Shop');

    const [folder] = collection.item;
    expect(folder.item[0].request.header).toEqual([{ key: 'X-Tenant', value: 'acme' }, { key: 'accept', value: 'text/csv' }]);
  });
});

describe('JWT and EdgeGrid auth in Postman', () => {
  const withAuth = (authentication: Record<string, unknown>) => [
    { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Signed' },
    { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'signed', method: 'GET', url: 'https://api.example.com', authentication },
  ];

  it('go out as Postman has them, and come back the same', async () => {
    const jwt = {
      type: 'jwt', disabled: false, algorithm: 'HS512', secret: '{{ secret }}', secretBase64: true, privateKey: '',
      payload: '{"sub":"kim"}', header: '{"kid":"k1"}', expiresIn: '', addTo: 'queryParams', prefix: 'Bearer', queryParamKey: 'access_token',
    };
    const edgegrid = { type: 'edgegrid', disabled: false, clientToken: 'ct', clientSecret: 'cs', accessToken: 'at', headersToSign: 'X-A, X-B', maxBody: '2048' };
    for (const authentication of [jwt, edgegrid]) {
      const collection = toPostmanCollection(withAuth(authentication), 'Signed') as any;
      expect(collection.item[0].request.auth.type).toBe(authentication.type);
      const imported = await importPostman(JSON.stringify(collection)) || [];
      const request = imported.find(({ name }) => name === 'signed');
      expect(request?.authentication).toEqual(authentication.type === 'jwt' ? { ...jwt, secret: '{{secret}}' } : edgegrid);
    }
  });
});
