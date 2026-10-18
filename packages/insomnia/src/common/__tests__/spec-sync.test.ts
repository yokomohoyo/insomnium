import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { isRequest, type Request } from '../../models/request';
import { isRequestGroup } from '../../models/request-group';
import { database as db } from '../database';
import { importToWorkspace, ResourceCache, scanResources } from '../import';
import { specSyncSummary, syncSpecToWorkspace } from '../spec-sync';

const spec = (paths: string) => `openapi: 3.0.0
info:
  title: Pets
  version: 1.0.0
servers:
  - url: https://pets.example.com/v1
tags:
  - name: pets
  - name: orders
paths:
${paths}`;

const listPets = (path: string, params: string[]) => `  ${path}:
    get:
      operationId: listPets
      summary: List pets
      tags: [pets]
      parameters:
${params.map(name => `        - name: ${name}
          in: query
          schema:
            type: string`).join('\n')}
`;

const v1 = spec(`${listPets('/pets', ['limit'])}  /pets/{id}:
    get:
      summary: Get a pet
      tags: [pets]
  /orders:
    post:
      summary: Place an order
      tags: [orders]
`);

// listPets moved and gained a parameter; the order went; deleting a pet is new
const v2 = spec(`${listPets('/animals', ['limit', 'sort'])}  /pets/{id}:
    get:
      summary: Get a pet
      tags: [pets]
    delete:
      summary: Delete a pet
      tags: [pets]
`);

describe('syncSpecToWorkspace()', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    const projectId = (await models.project.create({ name: 'Pets' }))._id;
    workspaceId = (await models.workspace.create({ name: 'Pets', parentId: projectId, scope: 'design' }))._id;
  });

  const resourcesOf = async (content: string) => {
    await scanResources({ content });
    return ResourceCache?.resources || [];
  };
  const generate = async (content: string) => syncSpecToWorkspace({ workspaceId, resources: await resourcesOf(content) });
  const requests = async () => {
    const workspace = await models.workspace.getById(workspaceId);
    return (await db.withDescendants(workspace)).filter(isRequest);
  };
  const byName = async (name: string) => (await requests()).find(request => request.name === name) as Request;

  it('generates the collection the first time', async () => {
    const result = await generate(v1);

    expect(result.added.map(request => `${request.method} ${request.url}`).sort()).toEqual([
      'GET {{ _.base_url }}/pets',
      'GET {{ _.base_url }}/pets/{{ _.id }}',
      'POST {{ _.base_url }}/orders',
    ]);
    expect(specSyncSummary(result)).toBe('');
    const folders = (await db.withDescendants(await models.workspace.getById(workspaceId))).filter(isRequestGroup);
    expect(folders.map(folder => folder.name).sort()).toEqual(['orders', 'pets']);
    // the base environment gets base_url, which the importer's requests use
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    expect(base.data).toMatchObject({ base_url: '{{ _.scheme }}://{{ _.host }}{{ _.base_path }}' });
    const [server] = await models.environment.findByParentId(base._id);
    expect(server.data).toMatchObject({ host: 'pets.example.com', base_path: '/v1' });
  });

  it('updates the requests it made instead of adding copies, and keeps what was set', async () => {
    await generate(v1);
    const list = await byName('List pets');
    await models.request.update(list, {
      name: 'All the pets',
      parameters: [{ name: 'limit', value: '5' }],
      body: { mimeType: 'application/json', text: '{}' },
    });
    const server = (await models.environment.findByParentId((await models.environment.getOrCreateForParentId(workspaceId))._id))[0];
    await models.environment.update(server, { data: { ...server.data, host: 'localhost:8080' } });

    const result = await generate(v2);

    expect(await requests()).toHaveLength(4);
    const moved = await byName('All the pets');
    expect(moved.url).toBe('{{ _.base_url }}/animals');
    expect(moved.parameters.map(param => [param.name, param.value])).toEqual([['limit', '5'], ['sort', 'string']]);
    expect(moved.body).toEqual({ mimeType: 'application/json', text: '{}' });
    // a new operation goes in its tag's folder, which is the one made before
    const deleted = await byName('Delete a pet');
    const pets = (await db.withDescendants(await models.workspace.getById(workspaceId))).filter(isRequestGroup).filter(folder => folder.name === 'pets');
    expect(pets).toHaveLength(1);
    expect(deleted.parentId).toBe(pets[0]._id);
    // gone from the spec, but not deleted
    expect(result.notInSpec.map(request => request.name)).toEqual(['Place an order']);
    expect(await byName('Place an order')).toBeTruthy();
    expect(specSyncSummary(result)).toBe('Updated 1 request and added 1; 1 already matched the spec. No longer in the spec, so left as they are: POST Place an order.');
    // the server's host as it was changed
    expect((await models.environment.getById(server._id))?.data.host).toBe('localhost:8080');
  });

  it('changes nothing when the spec is the same', async () => {
    await generate(v1);
    const before = await requests();

    const result = await generate(v1);

    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.unchanged).toHaveLength(3);
    expect((await requests()).map(request => request.modified).sort()).toEqual(before.map(request => request.modified).sort());
  });

  it('updates a copy of a generated request as well', async () => {
    await generate(v1);
    await models.request.duplicate(await byName('List pets'));

    await generate(v2);

    expect((await requests()).filter(request => request.url.endsWith('/animals'))).toHaveLength(2);
  });

  it('finds requests generated before they kept their operation', async () => {
    // what Generate Request Collection did before: an import with fresh ids
    await importToWorkspace({ workspaceId, resources: await resourcesOf(v1) });
    expect((await requests()).every(request => !request.specRequestId)).toBe(true);

    const result = await generate(v1);

    expect(result.added).toHaveLength(0);
    expect(await requests()).toHaveLength(3);
    expect((await requests()).every(request => request.specRequestId)).toBe(true);
  });
});
