import { beforeEach, describe, expect, it } from '@jest/globals';
import { ActionFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { updateWorkspaceAction } from '../actions';

const rename = (workspaceId: string, name: string) => updateWorkspaceAction({
  // what the action reads of the request
  request: { json: async () => ({ workspaceId, name }) },
  params: {},
} as unknown as ActionFunctionArgs);

describe('updateWorkspaceAction', () => {
  beforeEach(globalBeforeEach);

  it("renames a design document and its spec's file", async () => {
    const { _id } = await models.workspace.create({ name: 'Pets', scope: 'design' });
    await models.apiSpec.getOrCreateForParentId(_id);
    await rename(_id, 'Pet Store');
    expect((await models.workspace.getById(_id))?.name).toBe('Pet Store');
    expect((await models.apiSpec.getByParentId(_id))?.fileName).toBe('Pet Store');
  });

  it('renames a design document made without its spec, and gives it one', async () => {
    const { _id } = await models.workspace.create({ name: 'Pets', scope: 'design' });
    expect(await models.apiSpec.getByParentId(_id)).toBeNull();
    await rename(_id, 'Pet Store');
    expect((await models.workspace.getById(_id))?.name).toBe('Pet Store');
    expect((await models.apiSpec.getByParentId(_id))?.fileName).toBe('Pet Store');
  });

  it("doesn't give a collection a spec", async () => {
    const { _id } = await models.workspace.create({ name: 'Pets', scope: 'collection' });
    await rename(_id, 'Pet Store');
    expect(await models.apiSpec.getByParentId(_id)).toBeNull();
  });
});
