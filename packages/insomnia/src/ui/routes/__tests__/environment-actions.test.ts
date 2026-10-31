import { beforeEach, describe, expect, it } from '@jest/globals';
import { ActionFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { createEnvironmentAction, duplicateEnvironmentAction } from '../actions';

describe('making an environment in Manage Environments', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Pets' }))._id;
    await models.environment.getOrCreateForParentId(workspaceId);
  });

  const active = async () => (await models.workspaceMeta.getByParentId(workspaceId))?.activeEnvironmentId;

  it('shows a new environment, as the one to fill in', async () => {
    const created = await createEnvironmentAction({
      // what the action reads of the request
      request: { json: async () => ({ isPrivate: false }) },
      params: { workspaceId },
    } as unknown as ActionFunctionArgs) as { _id: string };
    expect(await active()).toBe(created._id);
  });

  it('shows a copy of an environment', async () => {
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    const original = await models.environment.create({ parentId: base._id, name: 'Staging' });
    const formData = new FormData();
    formData.set('environmentId', original._id);
    const copy = await duplicateEnvironmentAction({
      request: { formData: async () => formData },
      params: { workspaceId },
    } as unknown as ActionFunctionArgs) as { _id: string };
    expect(copy._id).not.toBe(original._id);
    expect(await active()).toBe(copy._id);
  });
});
