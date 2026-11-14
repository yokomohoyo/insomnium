import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../index';
import * as requestOperations from '../request-operations';

const requestModels = [
  ['request', models.request],
  ['grpcRequest', models.grpcRequest],
  ['webSocketRequest', models.webSocketRequest],
  ['mcpRequest', models.mcpRequest],
] as const;

describe('request-operations', () => {
  beforeEach(globalBeforeEach);

  it.each(requestModels)('getById() finds a %s', async (_, model: any) => {
    const created = await model.create({ parentId: 'wrk_1', name: 'A' });

    const found = await requestOperations.getById(created._id);

    expect(found?._id).toBe(created._id);
    expect(found?.type).toBe(model.type);
  });

  it('getById() resolves null for an unknown id', async () => {
    expect(await requestOperations.getById('req_missing')).toBeNull();
  });

  it.each(requestModels)('update() patches a %s', async (_, model: any) => {
    const created = await model.create({ parentId: 'wrk_1', name: 'A' });

    const updated = await requestOperations.update(created, { name: 'B' });

    expect(updated._id).toBe(created._id);
    expect(updated.type).toBe(model.type);
    expect(updated.name).toBe('B');
    expect((await model.getById(created._id)).name).toBe('B');
  });

  it('update() without a patch returns the document', async () => {
    const created = await models.request.create({ parentId: 'wrk_1', name: 'A' });

    const updated = await requestOperations.update(created);

    expect(updated.name).toBe('A');
  });

  it.each(requestModels)('duplicate() copies a %s with its own model', async (_, model: any) => {
    const created = await model.create({ parentId: 'wrk_1', name: 'A', metaSortKey: 10 });

    const copy = await requestOperations.duplicate(created);

    expect(copy._id).not.toBe(created._id);
    expect(copy.type).toBe(model.type);
    expect(copy.name).toBe('A (Copy)');
    expect(copy.metaSortKey).toBe(60);
    expect(await model.findByParentId('wrk_1')).toHaveLength(2);
  });

  it('duplicate() applies the patch', async () => {
    const created = await models.webSocketRequest.create({ parentId: 'wrk_1', name: 'A', metaSortKey: 10 });

    const copy = await requestOperations.duplicate(created, { name: 'B', parentId: 'wrk_2', metaSortKey: -1e9 });

    expect(copy.name).toBe('B');
    expect(copy.parentId).toBe('wrk_2');
    expect(copy.metaSortKey).toBe(-1e9);
  });

  it.each(requestModels)('remove() deletes a %s', async (_, model: any) => {
    const created = await model.create({ parentId: 'wrk_1', name: 'A' });

    await requestOperations.remove(created);

    expect(await requestOperations.getById(created._id)).toBeNull();
  });
});
