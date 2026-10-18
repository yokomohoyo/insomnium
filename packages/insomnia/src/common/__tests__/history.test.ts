import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { recentHistory } from '../history';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('recentHistory()', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it("lists every collection's responses, newest first, with where each request is", async () => {
    const shop = await models.workspace.create({ name: 'Shop' });
    const admin = await models.requestGroup.create({ parentId: shop._id, name: 'Admin' });
    const users = await models.requestGroup.create({ parentId: admin._id, name: 'Users' });
    const listUsers = await models.request.create({ parentId: users._id, name: 'List users', url: 'https://shop.example.com/users' });
    const pets = await models.workspace.create({ name: 'Pets' });
    const getPet = await models.request.create({ parentId: pets._id, name: 'Get pet', url: 'https://pets.example.com/pets/1' });
    const gone = await models.request.create({ parentId: pets._id, name: 'Gone' });

    const first = await models.response.create({ parentId: listUsers._id, statusCode: 200, url: 'https://shop.example.com/users' });
    await tick();
    await models.response.create({ parentId: gone._id, statusCode: 500 });
    await tick();
    const latest = await models.response.create({ parentId: getPet._id, statusCode: 404, url: 'https://pets.example.com/pets/1' });
    await models.request.remove(gone);

    const history = await recentHistory();
    expect(history.map(({ response, request, workspace, folders }) => [response._id, request.name, workspace.name, folders])).toEqual([
      [latest._id, 'Get pet', 'Pets', []],
      [first._id, 'List users', 'Shop', ['Admin', 'Users']],
    ]);
    expect(await recentHistory(1)).toHaveLength(1);
  });
});
