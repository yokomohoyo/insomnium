import { describe, expect, it } from '@jest/globals';

import { evaluateAssertions, RequestAssertion } from '../assertions';
import { findSpecOperation, schemaErrors } from '../schema-check';

const pet = { id: 7, name: 'Tom', tag: null };
const response = (body: unknown, extra = {}) => ({ statusCode: 200, body: JSON.stringify(body), ...extra });
const check = (assertion: Omit<RequestAssertion, 'id'>, under: ReturnType<typeof response>) => evaluateAssertions([{ id: 'a1', ...assertion }], under)[0];

const openapi = `
openapi: 3.0.3
info: { title: Pets, version: '1' }
servers:
  - url: https://pets.example.com/v1
paths:
  /pets/mine:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { type: array }
  /pets/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
        default:
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
components:
  schemas:
    Pet:
      type: object
      required: [id, name]
      properties:
        id: { type: integer }
        name: { type: string, pattern: '^(a+)+$' }
        tag: { type: string, nullable: true }
    Error:
      type: object
      required: [message]
`;

describe('schema assertions', () => {
  it('check the body, or a JSON path in it, against a JSON Schema given with the assertion', () => {
    const schema = JSON.stringify({ type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' } } });
    expect(check({ source: 'body', operator: 'matchesSchema', value: schema }, response(pet))).toEqual({ id: 'a1', passed: true, message: 'Body matches JSON schema' });
    expect(check({ source: 'body', operator: 'matchesSchema', value: schema }, response({ id: 'seven' }))).toEqual({
      id: 'a1',
      passed: false,
      message: "Body matches JSON schema: the value must have required property 'name'; /id must be integer",
    });
    expect(check({ source: 'jsonpath', property: '$.name', operator: 'matchesSchema', value: '{"type": "string", "maxLength": 2}' }, response(pet)).message)
      .toBe('JSON path $.name matches JSON schema: the value must NOT have more than 2 characters');
    expect(check({ source: 'body', operator: 'matchesSchema', value: 'not json' }, response(pet)).message).toBe('Body matches JSON schema: the schema is not JSON');
    expect(check({ source: 'status', operator: 'matchesSchema', value: '{}' }, response(pet)).message).toBe('Status code matches JSON schema: a schema checks the body, or a JSON path in it');
  });

  it("check the body against the response schema of the matching operation in the workspace's spec", () => {
    const under = (body: unknown, url: string, statusCode = 200) => response(body, { url, statusCode, method: 'GET', spec: openapi });
    expect(check({ source: 'body', operator: 'matchesSpec' }, under(pet, 'https://pets.example.com/v1/pets/7?expand=1'))).toEqual({
      id: 'a1', passed: true, message: 'Body matches the API spec (GET /pets/{id} 200)',
    });
    expect(check({ source: 'body', operator: 'matchesSpec' }, under({ id: 7 }, 'https://pets.example.com/v1/pets/7')).message)
      .toBe("Body matches the API spec: the value must have required property 'name' (GET /pets/{id} 200)");
    // a template without parameters wins, and other codes fall to default
    expect(check({ source: 'body', operator: 'matchesSpec' }, under(pet, 'https://pets.example.com/v1/pets/mine')).message)
      .toBe('Body matches the API spec: the value must be array (GET /pets/mine 200)');
    expect(check({ source: 'body', operator: 'matchesSpec' }, under({ message: 'gone' }, 'https://pets.example.com/v1/pets/7', 404)).passed).toBe(true);
    expect(check({ source: 'body', operator: 'matchesSpec' }, under(pet, 'https://pets.example.com/v1/owners/1')).message)
      .toBe('Body matches the API spec: the spec has no operation for GET /v1/owners/1');
    expect(check({ source: 'body', operator: 'matchesSpec' }, response(pet, { url: 'https://x.example.com/', method: 'GET' })).message)
      .toBe('Body matches the API spec: the workspace has no API spec');
  });

  it("read Swagger 2's basePath and response schemas", () => {
    const swagger = JSON.stringify({
      swagger: '2.0',
      basePath: '/api',
      paths: { '/pets/{id}': { get: { responses: { 200: { schema: { $ref: '#/definitions/Pet' } } } } } },
      definitions: { Pet: { type: 'object', required: ['id'] } },
    });
    expect(findSpecOperation(swagger, 'get', 'http://localhost/api/pets/1', 200)).toEqual({ label: 'GET /pets/{id} 200', schemaPointer: '#/paths/~1pets~1{id}/get/responses/200/schema' });
    expect(check({ source: 'body', operator: 'matchesSpec' }, response({}, { url: 'http://localhost/api/pets/1', method: 'GET', spec: swagger })).passed).toBe(false);
  });

  it("leave out a schema's own patterns, which could hang the app, and don't check formats", () => {
    // catastrophic on a long run of a's followed by a b, if it ran
    expect(schemaErrors({ type: 'string', pattern: '^(a+)+$' }, `${'a'.repeat(40)}b`)).toEqual([]);
    expect(schemaErrors({ type: 'object', patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false }, { 'x-a': 1 })).toEqual([]);
    expect(schemaErrors({ type: 'string', format: 'email' }, 'not an email')).toEqual([]);
  });
});
