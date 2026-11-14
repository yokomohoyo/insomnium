import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../index';
import { duplicateAfter } from '../duplicate-after';

describe('duplicateAfter()', () => {
  beforeEach(globalBeforeEach);

  it('puts the copy 50 after the original when nothing follows it', async () => {
    const request = await models.request.create({ parentId: 'wrk_1', name: 'A', metaSortKey: 10 });

    const copy = await duplicateAfter(models.request.type, request);

    expect(copy._id).not.toBe(request._id);
    expect(copy.type).toBe(models.request.type);
    expect(copy.parentId).toBe('wrk_1');
    expect(copy.name).toBe('A');
    expect(copy.metaSortKey).toBe(60);
  });

  it('puts the copy halfway to the next document', async () => {
    const request = await models.request.create({ parentId: 'wrk_1', metaSortKey: 10 });
    await models.request.create({ parentId: 'wrk_1', metaSortKey: 500 });
    await models.request.create({ parentId: 'wrk_1', metaSortKey: 20 });
    await models.request.create({ parentId: 'wrk_1', metaSortKey: 5 });

    const copy = await duplicateAfter(models.request.type, request);

    expect(copy.metaSortKey).toBe(15);
  });

  it('only looks at documents of the given type', async () => {
    const request = await models.request.create({ parentId: 'wrk_1', metaSortKey: 10 });
    await models.grpcRequest.create({ parentId: 'wrk_1', metaSortKey: 20 });

    const copy = await duplicateAfter(models.request.type, request);

    expect(copy.metaSortKey).toBe(60);
  });

  // as it has always been: the next document is not looked up among siblings
  it('takes the next document from any parent', async () => {
    const request = await models.request.create({ parentId: 'wrk_1', metaSortKey: 10 });
    await models.request.create({ parentId: 'wrk_2', metaSortKey: 20 });

    const copy = await duplicateAfter(models.request.type, request);

    expect(copy.metaSortKey).toBe(15);
  });

  it('lets the patch win, sort key included', async () => {
    const request = await models.request.create({ parentId: 'wrk_1', name: 'A', metaSortKey: 10 });

    const copy = await duplicateAfter(models.request.type, request, {
      name: 'B',
      parentId: 'wrk_2',
      metaSortKey: -1e9,
    });

    expect(copy.name).toBe('B');
    expect(copy.parentId).toBe('wrk_2');
    expect(copy.metaSortKey).toBe(-1e9);
  });
});

describe('duplicate() of each model', () => {
  beforeEach(globalBeforeEach);

  const requestModels = [
    ['request', models.request],
    ['grpcRequest', models.grpcRequest],
    ['webSocketRequest', models.webSocketRequest],
    ['mcpRequest', models.mcpRequest],
  ] as const;

  it.each(requestModels)('%s: names the copy "(Copy)" and places it after', async (_, model: any) => {
    const original = await model.create({ parentId: 'wrk_1', name: 'A', metaSortKey: 10 });
    await model.create({ parentId: 'wrk_1', name: 'B', metaSortKey: 30 });

    const copy = await model.duplicate(original);

    expect(copy._id).not.toBe(original._id);
    expect(copy.type).toBe(model.type);
    expect(copy.name).toBe('A (Copy)');
    expect(copy.metaSortKey).toBe(20);
  });

  it.each(requestModels)('%s: keeps a name from the patch', async (_, model: any) => {
    const original = await model.create({ parentId: 'wrk_1', name: 'A', metaSortKey: 10 });

    const copy = await model.duplicate(original, { name: 'B' });

    expect(copy.name).toBe('B');
    expect(copy.metaSortKey).toBe(60);
  });

  it.each(requestModels)('%s: leaves an unnamed copy unnamed', async (_, model: any) => {
    const original = await model.create({ parentId: 'wrk_1', name: '', metaSortKey: 10 });

    const copy = await model.duplicate(original);

    expect(copy.name).toBe('');
  });

  it('requestGroup: always names the copy "(Copy)" and places it after', async () => {
    const folder = await models.requestGroup.create({ parentId: 'wrk_1', name: 'F', metaSortKey: 10 });
    const unnamed = await models.requestGroup.create({ parentId: 'wrk_1', name: '', metaSortKey: 30 });

    const copy = await models.requestGroup.duplicate(folder);
    const unnamedCopy = await models.requestGroup.duplicate(unnamed);
    const renamed = await models.requestGroup.duplicate(folder, { name: 'G' });

    expect(copy.name).toBe('F (Copy)');
    expect(copy.metaSortKey).toBe(20);
    expect(unnamedCopy.name).toBe(' (Copy)');
    expect(unnamedCopy.metaSortKey).toBe(80);
    expect(renamed.name).toBe('G');
  });
});
