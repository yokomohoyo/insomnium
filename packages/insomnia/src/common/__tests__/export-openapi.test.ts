import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';

import { convert } from '../../utils/importers/convert';
import { schemaOf, splitUrl, toOpenApi, toOpenApiPath, toOpenApiYaml } from '../export-openapi';

const resources = [
  { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Shop', description: 'The shop API' },
  { _id: 'env_1', _type: 'environment', parentId: 'wrk_1', name: 'Base Environment', data: { base_url: '{{ _.scheme }}://{{ _.host }}', scheme: 'https', host: 'shop.example.com' } },
  { _id: 'env_2', _type: 'environment', parentId: 'env_1', name: 'Staging', data: { host: 'staging.example.com' } },
  { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'Orders', description: 'Placing orders', metaSortKey: 1, authentication: { type: 'bearer', token: '{{ _.token }}' } },
  {
    _id: 'req_1', _type: 'request', parentId: 'fld_1', name: 'Create order', metaSortKey: 1, method: 'POST',
    url: '{{ _.base_url }}/orders/:shop', segmentParams: [{ name: 'shop', value: 'main' }],
    parameters: [{ name: 'dry', value: 'true' }],
    headers: [{ name: 'X-Trace', value: "{% faker 'randomUUID' %}" }, { name: 'Content-Type', value: 'application/json' }],
    body: { mimeType: 'application/json', text: '{"item": "book", "count": 2}' },
    authentication: {},
  },
  { _id: 'ex_1', _type: 'response_example', parentId: 'req_1', name: 'Created', statusCode: 201, statusMessage: 'Created', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"id": 1}' },
  // a variant of the one above, so not a second operation
  { _id: 'req_2', _type: 'request', parentId: 'fld_1', name: 'Create order (dry run)', metaSortKey: 2, method: 'POST', url: '{{ _.base_url }}/orders/:shop' },
  {
    _id: 'req_3', _type: 'request', parentId: 'wrk_1', name: 'Sign in', metaSortKey: 2, method: 'POST', url: '{{ base_url }}/session',
    body: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'user', value: 'kim' }, { name: 'password', value: '{{ password }}' }] },
    authentication: [{ type: 'basic', username: 'kim', password: '{{ password }}' }],
  },
  { _id: 'req_4', _type: 'request', parentId: 'wrk_1', name: 'Health', metaSortKey: 3, method: 'GET', url: 'https://status.example.com/health?verbose=1', authentication: { type: 'none' } },
  { _id: 'greq_1', _type: 'grpc_request', parentId: 'wrk_1', name: 'gRPC is left out' },
];

describe('toOpenApi()', () => {
  it("writes Insomnium's variables and a path's :name as OpenAPI's {name}", () => {
    expect(toOpenApiPath('/shops/{{ _.shop }}/orders/:id/{{ item }}')).toBe('/shops/{shop}/orders/{id}/{item}');
    expect(splitUrl('{{ _.base_url }}/pets?limit=1')).toEqual({ server: '{{ _.base_url }}', path: '/pets' });
    expect(splitUrl('https://api.example.com:8080/v1/pets')).toEqual({ server: 'https://api.example.com:8080', path: '/v1/pets' });
    expect(splitUrl('localhost:3000/pets')).toEqual({ server: 'localhost:3000', path: '/pets' });
    expect(schemaOf({ id: 1, price: 2.5, tags: ['a'], ok: true, note: null })).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, price: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } }, ok: { type: 'boolean' }, note: { nullable: true } },
    });
  });

  it('describes the requests: servers from the environments, operations, tags, bodies, examples and security', () => {
    const document = toOpenApi(resources, 'Shop export') as any;

    expect(document.openapi).toBe('3.0.3');
    expect(document.info).toEqual({ title: 'Shop', description: 'The shop API', version: '1.0.0' });
    expect(document.servers).toEqual([
      { url: 'https://shop.example.com', description: 'Base Environment' },
      { url: 'https://staging.example.com', description: 'Staging' },
    ]);
    expect(document.tags).toEqual([{ name: 'Orders', description: 'Placing orders' }]);
    expect(Object.keys(document.paths)).toEqual(['/orders/{shop}', '/session', '/health']);

    expect(document.paths['/orders/{shop}']).toEqual({
      post: {
        tags: ['Orders'],
        summary: 'Create order',
        operationId: 'createOrder',
        parameters: [
          { name: 'shop', in: 'path', required: true, schema: { type: 'string' }, example: 'main' },
          { name: 'dry', in: 'query', schema: { type: 'string' }, example: 'true' },
          // a tag isn't an example
          { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'integer' } } },
              example: { item: 'book', count: 2 },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } }, example: { id: 1 } } } },
        },
        // the folder's, which the request inherits
        security: [{ bearerAuth: [] }],
      },
    });

    expect(document.paths['/session'].post).toMatchObject({
      requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { user: { type: 'string', example: 'kim' }, password: { type: 'string' } } } } } },
      responses: { default: { description: 'Response' } },
      security: [{ basicAuth: [] }],
    });
    expect(document.paths['/session'].post.tags).toBeUndefined();

    expect(document.paths['/health'].get).toMatchObject({
      servers: [{ url: 'https://status.example.com' }],
      parameters: [{ name: 'verbose', in: 'query', schema: { type: 'string' }, example: '1' }],
      security: [],
    });
    expect(document.components).toEqual({ securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, basicAuth: { type: 'http', scheme: 'basic' } } });
    expect(JSON.stringify(document)).not.toContain('gRPC');
    expect(JSON.stringify(document)).not.toContain('dry run');
  });

  it('leaves server variables to set when no environment resolves them', () => {
    const document = toOpenApi([
      { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Bare' },
      { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'List', method: 'GET', url: '{{ _.base_url }}/items' },
    ], 'Bare') as any;

    expect(document.servers).toEqual([{ url: '{base_url}', variables: { base_url: { default: '' } } }]);
    expect(document.paths['/items'].get.operationId).toBe('list');
  });

  it('describes API key and OAuth 2 auth', () => {
    const document = toOpenApi([
      { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Keys' },
      { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'Key', method: 'GET', url: 'https://api.example.com/a', authentication: { type: 'apikey', key: 'X-Api-Key', value: '{{ key }}', addTo: 'header' } },
      { _id: 'req_2', _type: 'request', parentId: 'wrk_1', name: 'OAuth', method: 'GET', url: 'https://api.example.com/b', authentication: { type: 'oauth2', grantType: 'client_credentials', accessTokenUrl: 'https://auth.example.com/token', scope: 'read write' } },
    ], 'Keys') as any;

    expect(document.paths['/a'].get.security).toEqual([{ 'apiKey_X-Api-Key': [] }]);
    expect(document.paths['/b'].get.security).toEqual([{ oauth2: ['read', 'write'] }]);
    expect(document.components.securitySchemes).toEqual({
      'apiKey_X-Api-Key': { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      oauth2: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://auth.example.com/token', scopes: { read: '', write: '' } } } },
    });
  });

  it('imports back as the same requests', async () => {
    const yaml = toOpenApiYaml(resources, 'Shop export');
    expect(YAML.parse(yaml).openapi).toBe('3.0.3');

    const { type, data } = (await convert(yaml)) as any;

    expect(type.id).toBe('openapi3');
    const requests = data.resources.filter((resource: any) => resource._type === 'request');
    expect(requests.map((request: any) => `${request.method} ${request.url}`)).toEqual([
      'POST {{ _.base_url }}/orders/{{ _.shop }}',
      'POST {{ _.base_url }}/session',
      'GET {{ _.base_url }}/health',
    ]);
    expect(requests.map((request: any) => request.name)).toEqual(['Create order', 'Sign in', 'Health']);
  });
});
