/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';
import YAML from 'yaml';

import { clientFromExport, typescriptClient } from '../openapi-client';

const petstore = YAML.parse(`
openapi: 3.0.3
info: { title: Pet Store, version: 1.0.0 }
servers:
  - url: https://{region}.pets.example.com/v1
    variables: { region: { default: eu } }
paths:
  /pets:
    get:
      operationId: listPets
      summary: List the pets
      parameters:
        - { name: limit, in: query, schema: { type: integer } }
        - { name: tags, in: query, schema: { type: array, items: { type: string } } }
        - { name: X-Request-Id, in: header, schema: { type: string } }
      responses:
        '200': { description: ok, content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Pet' } } } } }
    post:
      operationId: create-pet
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/NewPet' } } } }
      responses:
        '201': { description: created, content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
  /pets/{pet-id}:
    parameters:
      - $ref: '#/components/parameters/PetId'
    get:
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
    delete:
      deprecated: true
      operationId: delete
      responses:
        '204': { description: gone }
components:
  parameters:
    PetId: { name: pet-id, in: path, required: true, schema: { type: string } }
  schemas:
    Pet:
      description: A pet */ with a comment end
      allOf:
        - $ref: '#/components/schemas/NewPet'
        - type: object
          required: [id]
          properties: { id: { type: integer } }
    NewPet:
      type: object
      required: [name]
      properties:
        name: { type: string }
        status: { type: string, enum: [available, sold], nullable: true }
        photo-urls: { type: array, items: { type: string } }
        extra: { type: object, additionalProperties: { type: number } }
`);

// the client, and code using it, compiled together: what's wrong with either
const typeErrors = (code: string) => {
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) => (name === 'client.ts' ? ts.createSourceFile(name, code, version) : getSourceFile(name, version, ...rest));
  const fileExists = host.fileExists.bind(host);
  host.fileExists = name => name === 'client.ts' || fileExists(name);
  const program = ts.createProgram(['client.ts'], options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

// the client, run with a fetch that answers as given and records what it's asked
const run = (code: string, answer: { status: number; body?: unknown }) => {
  const sent: { url: string; init: any }[] = [];
  class FakeHeaders {
    values = new Map<string, string>();
    constructor(init?: Record<string, string>) {
      Object.entries(init || {}).forEach(([name, value]) => this.set(name, value));
    }
    set(name: string, value: string) {
      this.values.set(name.toLowerCase(), value);
    }
    get(name: string) {
      return this.values.get(name.toLowerCase()) ?? null;
    }
  }
  const fetch = async (url: string, init: any) => {
    sent.push({ url, init });
    const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
    return { ok: answer.status < 300, status: answer.status, url, text: async () => text, headers: new FakeHeaders({ 'content-type': 'application/json' }) };
  };
  const { outputText } = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports: Record<string, any> = {};
  new Function('exports', 'Headers', outputText)(exports, FakeHeaders);
  return { client: exports.createClient({ fetch, headers: { Authorization: 'Bearer t' } }), sent, exports };
};

describe('typescriptClient()', () => {
  const code = typescriptClient(petstore);

  it('writes a client that compiles, with types from the schemas', () => {
    expect(code).toContain('export type Pet = (NewPet & { id: number; });');
    expect(code).toContain('export type NewPet = { name: string; status?: "available" | "sold" | null; "photo-urls"?: Array<string>; extra?: { [key: string]: number; }; };');
    expect(code).toContain('/** A pet *\\/ with a comment end */');
    expect(code).toContain('@deprecated');

    expect(typeErrors(`${code}
const api = createClient();
export async function use() {
  const pets: Pet[] = await api.listPets({ limit: 2, tags: ['a', 'b'], 'X-Request-Id': 'r1' });
  const all: Pet[] = await api.listPets();
  const created: Pet = await api.createPet({ body: { name: 'Tom' } });
  const one: Pet = await api.getPetsByPetId({ 'pet-id': '1' });
  const gone: void = await api.deleteOperation({ 'pet-id': '1' });
  // @ts-expect-error -- the body is required
  await api.createPet({});
  // @ts-expect-error -- the path parameter is required
  await api.getPetsByPetId();
  return [pets, all, created, one, gone];
}
`)).toEqual([]);
  });

  it('sends each operation as its spec says, and answers with the JSON', async () => {
    const { client, sent } = run(code, { status: 200, body: [{ id: 1, name: 'Tom' }] });

    await expect(client.listPets({ limit: 2, tags: ['a', 'b'], 'X-Request-Id': 'r1' })).resolves.toEqual([{ id: 1, name: 'Tom' }]);
    await client.createPet({ body: { name: 'Tom' } });
    await client.getPetsByPetId({ 'pet-id': 'a/b' });

    expect(sent.map(({ url, init }) => [init.method, url])).toEqual([
      ['GET', 'https://eu.pets.example.com/v1/pets?limit=2&tags=a&tags=b'],
      ['POST', 'https://eu.pets.example.com/v1/pets'],
      ['GET', 'https://eu.pets.example.com/v1/pets/a%2Fb'],
    ]);
    expect(sent[0].init.headers.get('x-request-id')).toBe('r1');
    expect(sent[0].init.headers.get('authorization')).toBe('Bearer t');
    expect(sent[1].init.body).toBe('{"name":"Tom"}');
    expect(sent[1].init.headers.get('content-type')).toBe('application/json');
  });

  it('throws an ApiError for a response that is not 2xx', async () => {
    const { client, exports } = run(code, { status: 404, body: { message: 'no such pet' } });

    const error = await client.getPetsByPetId({ 'pet-id': '9' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(exports.ApiError);
    expect(error).toMatchObject({ status: 404, body: { message: 'no such pet' } });
  });

  it("can't be made to run a spec's text as code", async () => {
    const hostile = typescriptClient({
      openapi: '3.0.0',
      info: { title: 'Evil\nglobalThis.titled = 1;', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/a`${globalThis.pathed = 1}\\`/{id}': {
          get: { operationId: 'grab', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'ok' } } },
        },
      },
    });
    expect(typeErrors(hostile)).toEqual([]);

    const { client, sent } = run(hostile, { status: 200 });
    await client.grab({ id: '1' });

    expect(sent[0].url).toBe('https://api.example.com/a`${globalThis.pathed = 1}\\`/1');
    expect((globalThis as any).pathed).toBeUndefined();
    expect((globalThis as any).titled).toBeUndefined();
  });

  it("makes one from a collection's requests when there's no spec", () => {
    const client = clientFromExport([
      { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Shop' },
      { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'List orders', method: 'GET', url: 'https://shop.example.com/orders', headers: [], parameters: [], body: {} },
    ], 'Shop');

    expect(client).toContain('listOrders: (');
    expect(client).toContain('"https://shop.example.com"');
    expect(typeErrors(client)).toEqual([]);
  });
});
