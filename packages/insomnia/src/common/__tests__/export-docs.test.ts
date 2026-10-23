/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';

import { docsFromExport, docsModel, toHtmlDocs, toMarkdownDocs } from '../export-docs';

const petstore = YAML.parse(`
openapi: 3.0.3
info: { title: Pet Store, version: 2.1.0, description: 'All the **pets**.' }
servers:
  - url: https://{region}.pets.example.com/v1
    description: Production
    variables: { region: { default: eu } }
tags:
  - { name: Pets, description: Everything about pets }
  - { name: Unused }
security:
  - bearerAuth: []
paths:
  /pets:
    get:
      tags: [Pets]
      summary: List the pets
      parameters:
        - { name: limit, in: query, description: 'at most | this many', schema: { type: integer, example: 10 } }
      responses:
        '200':
          description: The pets
          content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Pet' } } } }
    post:
      tags: [Pets]
      summary: Add a pet
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/NewPet' }
            examples: { cat: { value: { name: Tom } } }
      responses:
        '201': { description: Added }
  /pets/{petId}:
    parameters:
      - $ref: '#/components/parameters/PetId'
    delete:
      deprecated: true
      summary: Remove a pet
      responses:
        '204': { description: Gone }
components:
  parameters:
    PetId: { name: petId, in: path, required: true, schema: { type: string, format: uuid } }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
    key: { type: apiKey, in: header, name: X-Key }
  schemas:
    NewPet:
      type: object
      required: [name]
      properties:
        name: { type: string, description: What it answers to }
        status: { type: string, enum: [available, sold], nullable: true }
        born: { type: string, format: date-time }
    Pet:
      description: A pet
      allOf:
        - $ref: '#/components/schemas/NewPet'
        - type: object
          required: [id]
          properties: { id: { type: integer } }
`);

describe('docsModel', () => {
  const model = docsModel(petstore);

  it('reads the title, servers and auth', () => {
    expect(model).toMatchObject({ title: 'Pet Store', version: '2.1.0', description: 'All the **pets**.' });
    expect(model.servers).toEqual([{ url: 'https://eu.pets.example.com/v1', description: 'Production' }]);
    expect(model.securitySchemes).toEqual([
      { name: 'bearerAuth', description: 'HTTP bearer (JWT)' },
      { name: 'key', description: 'API key in the header "X-Key"' },
    ]);
  });

  it("groups operations by tag, in the spec's order, untagged ones last; a tag with none is left out", () => {
    expect(model.sections.map(section => [section.name, section.anchor, section.operations.map(operation => operation.anchor)])).toEqual([
      ['Pets', 'pets', ['get-list-the-pets', 'post-add-a-pet']],
      ['Requests', 'requests', ['delete-remove-a-pet']],
    ]);
    expect(model.sections[0].description).toBe('Everything about pets');
  });

  it("follows $refs, and takes the path's parameters", () => {
    const remove = model.sections[1].operations[0];
    expect(remove).toMatchObject({ method: 'DELETE', path: '/pets/{petId}', deprecated: true, security: ['bearerAuth'] });
    expect(remove.parameters).toEqual([{ name: 'petId', in: 'path', type: 'string (uuid)', required: true, description: '', example: '' }]);
  });

  it('describes bodies and responses, with an example from the spec or one made from the schema', () => {
    const [list, add] = model.sections[0].operations;
    expect(list.parameters[0]).toMatchObject({ name: 'limit', type: 'integer', required: false, example: '10' });
    expect(list.responses[0]).toMatchObject({ status: '200', description: 'The pets', contents: [{ type: 'application/json', exampleLanguage: 'json' }] });
    expect(JSON.parse(list.responses[0].contents[0].example!)).toEqual([{ name: 'string', status: 'available', born: '2026-01-01T00:00:00Z', id: 0 }]);
    expect(add.security).toEqual([]);
    expect(add.requestBody).toMatchObject({ required: true, contents: [{ example: '{\n  "name": "Tom"\n}' }] });
    expect(add.requestBody!.contents[0].rows.map(row => [row.name, row.type, row.required])).toEqual([
      ['name', 'string', true],
      ['status', 'one of "available", "sold", nullable', false],
      ['born', 'string (date-time)', false],
    ]);
  });

  it("lists the schemas, an allOf's parts merged", () => {
    const pet = model.schemas.find(schema => schema.name === 'Pet')!;
    expect(pet).toMatchObject({ anchor: 'schema-pet', description: 'A pet', type: 'NewPet and object' });
    expect(pet.rows.map(row => [row.name, row.required])).toEqual([['name', true], ['status', false], ['born', false], ['id', true]]);
  });

  it('gives each heading its own anchor', () => {
    const twice = docsModel({ paths: { '/a': { get: { summary: 'Same' } }, '/b': { get: { summary: 'Same' } } } });
    expect(twice.sections[0].operations.map(operation => operation.anchor)).toEqual(['get-same', 'get-same-2']);
  });

  it('copes with a spec that is mostly missing', () => {
    expect(docsModel({})).toEqual({ title: 'API', version: '', description: '', servers: [], securitySchemes: [], sections: [], schemas: [] });
    expect(() => toHtmlDocs({ paths: { '/x': { get: null, post: { parameters: [null, { $ref: '#/nowhere' }], responses: { 200: null } } } } })).not.toThrow();
  });
});

describe('toMarkdownDocs', () => {
  const markdown = toMarkdownDocs(petstore);

  it('writes the sections, contents and tables', () => {
    expect(markdown).toMatch(/^# Pet Store 2\.1\.0\n\nAll the \*\*pets\*\*\.\n/);
    expect(markdown).toContain('- [Pets](#pets)\n  - [GET List the pets](#get-list-the-pets)');
    expect(markdown).toContain('<a id="get-list-the-pets"></a>\n\n### GET List the pets\n\n`GET /pets`');
    expect(markdown).toContain('| `limit` | query | integer | no | at most \\| this many | `10` |');
    expect(markdown).toContain('> **Deprecated**');
    expect(markdown).toContain('Authentication: none');
    expect(markdown).toContain('## Schemas');
  });

  it("fences an example so its own backticks can't close the block", () => {
    const docs = toMarkdownDocs({ paths: { '/x': { get: { responses: { 200: { description: 'ok', content: { 'text/plain': { example: 'a\n```\nb' } } } } } } } });
    expect(docs).toContain('````\na\n```\nb\n````');
  });
});

describe('toHtmlDocs', () => {
  it('is one page with nothing to load, its styles inline, light and dark', () => {
    const html = toHtmlDocs(petstore);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Pet Store 2.1.0</title>');
    expect(html).toContain("content=\"default-src 'none'; style-src 'unsafe-inline'; img-src https: data:\"");
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('<p>All the <strong>pets</strong>.</p>');
    expect(html).toContain('<h3 id="delete-remove-a-pet"><span class="method DELETE">DELETE</span>Remove a pet</h3>');
    expect(html).not.toMatch(/<script|<link|src="http:/i);
  });

  it("shows a spec's HTML as text and keeps only safe links", () => {
    const html = toHtmlDocs({
      info: { title: '<b>Evil</b>', description: 'Hi <script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[run](javascript:alert(1)) [ok](https://example.com) ![pic](javascript:x)' },
      tags: [{ name: '"><svg onload=alert(1)>', description: '<iframe src="https://example.com"></iframe>' }],
      paths: { '/x': { get: { tags: ['"><svg onload=alert(1)>'], summary: '<img src=x>', responses: { 200: { description: '<b>ok</b>', content: { 'text/html': { example: '</code></pre><script>x</script>' } } } } } } },
    });
    expect(html).not.toMatch(/<script|<img|<svg|<iframe|<b>|javascript:/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer">ok</a>');
    expect(html).toContain('run');
    expect(html).toContain('<title>&lt;b&gt;Evil&lt;/b&gt;</title>');
  });
});

describe('docsFromExport', () => {
  const workspace = { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Shop', description: 'The shop API' };
  const folder = { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'Orders', description: 'Placing orders', metaSortKey: 1 };
  const request = { _id: 'req_1', _type: 'request', parentId: 'fld_1', name: 'Place an order', method: 'POST', url: 'https://shop.example.com/orders', description: 'Sends it **now**', body: { mimeType: 'application/json', text: '{"item":"book"}' }, headers: [], parameters: [], authentication: { type: 'bearer', token: '{{ token }}' } };
  const example = { _id: 'ex_1', _type: 'response_example', parentId: 'req_1', name: 'Placed', statusCode: 201, statusMessage: 'Created', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"id":7}' };

  it("documents a collection's requests: folders as sections, saved examples as responses", () => {
    const markdown = docsFromExport([workspace, folder, request, example], 'Export', 'markdown');
    expect(markdown).toMatch(/^# Shop 1\.0\.0\n\nThe shop API\n/);
    expect(markdown).toContain('## Orders\n\nPlacing orders');
    expect(markdown).toContain('### POST Place an order\n\n`POST /orders`\n\nSends it **now**');
    expect(markdown).toContain('Authentication: bearerAuth');
    expect(markdown).toContain('**201** Created');
    expect(markdown).toContain('```json\n{\n  "id": 7\n}\n```');
    expect(markdown).toContain('- `https://shop.example.com`');
  });

  it("documents a design document's spec when it has one", () => {
    const spec = { _id: 'spc_1', _type: 'api_spec', parentId: 'wrk_1', contents: YAML.stringify(petstore) };
    expect(docsFromExport([workspace, spec, request], 'Export', 'html')).toContain('<title>Pet Store 2.1.0</title>');
  });
});
