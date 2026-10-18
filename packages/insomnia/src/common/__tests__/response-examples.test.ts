import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { convert as convertPostman } from '../../utils/importers/importers/postman';
import { exportRequestsData } from '../export';
import { scanResources } from '../import';
import { importResourcesToProject } from '../importResourcesToProject';

describe('response examples', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it("come with an export, for the requests exported, and back with an import", async () => {
    const workspace = await models.workspace.create({ name: 'Pets' });
    const getPet = await models.request.create({ parentId: workspace._id, name: 'Get pet', url: 'https://pets.example.com/pets/1' });
    const other = await models.request.create({ parentId: workspace._id, name: 'Other' });
    await models.responseExample.create({ parentId: getPet._id, name: 'Found', statusCode: 200, headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"id": 1}' });
    await models.responseExample.create({ parentId: other._id, name: 'Not exported' });

    const exported = JSON.parse(await exportRequestsData([getPet], false, 'json'));
    expect(exported.resources.filter(({ _type }: { _type: string }) => _type === 'response_example').map(({ name }: { name: string }) => name)).toEqual(['Found']);

    const project = await models.project.create({ name: 'Elsewhere' });
    await scanResources({ content: JSON.stringify(exported) });
    await importResourcesToProject({ projectId: project._id });
    const imported = (await models.request.all()).find(request => request.name === 'Get pet' && request._id !== getPet._id);
    expect(await models.responseExample.findByParentId(imported!._id)).toEqual([
      expect.objectContaining({ name: 'Found', statusCode: 200, body: '{"id": 1}', headers: [{ name: 'Content-Type', value: 'application/json' }] }),
    ]);
  });

  it("are Postman's saved responses, on import", async () => {
    const resources = await convertPostman(JSON.stringify({
      info: { name: 'Pets', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'Get pet',
        request: { method: 'GET', url: 'https://pets.example.com/pets/1' },
        response: [
          { name: 'Found', code: 200, status: 'OK', header: [{ key: 'Content-Type', value: 'application/json' }], body: '{"id": "{{$guid}}"}' },
          { code: 404, status: 'Not Found', header: 'not a list' },
        ],
      }],
    })) || [];
    const request = resources.find(({ _type }) => _type === 'request');
    expect(resources.filter(({ _type }) => _type === 'response_example')).toEqual([
      { _id: '__EX_1__', _type: 'response_example', parentId: request?._id, name: 'Found', statusCode: 200, statusMessage: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], body: "{\"id\": \"{% faker 'guid' %}\"}" },
      { _id: '__EX_2__', _type: 'response_example', parentId: request?._id, name: '404 Not Found', statusCode: 404, statusMessage: 'Not Found', headers: [], body: '' },
    ]);
  });
});
