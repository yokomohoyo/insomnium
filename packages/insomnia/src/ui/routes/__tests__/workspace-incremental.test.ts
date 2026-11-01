import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { database } from '../../../common/database';
import * as models from '../../../models';
import type { BaseModel } from '../../../models';
import { forgetCollectionRead, workspaceLoader, type WorkspaceLoaderData } from '../workspace';

// more ids than the mocked list has
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

// The loader reads what was written since its last load. What it gives must be
// what reading it all gives.
describe('workspaceLoader, reading only what changed', () => {
  beforeEach(globalBeforeEach);

  const load = async (projectId: string, workspaceId: string, search = '') =>
    await workspaceLoader({ request: { url: `http://localhost/${search}` }, params: { projectId, workspaceId } } as any) as WorkspaceLoaderData;
  const shape = ({ collection, grpcRequests }: WorkspaceLoaderData) => ({
    collection: collection.map(({ doc, pinned, collapsed, hidden, level, ancestors }) => ({ doc, pinned, collapsed, hidden, level, ancestors })),
    grpcRequests,
  });

  const setUp = async () => {
    const project = await models.project.create({ name: 'Project' });
    const workspace = await models.workspace.create({ name: 'Workspace', parentId: project._id });
    const other = await models.workspace.create({ name: 'Other', parentId: project._id });
    const folder = await models.requestGroup.create({ parentId: workspace._id, name: 'Folder', metaSortKey: 0 });
    const inner = await models.requestGroup.create({ parentId: folder._id, name: 'Inner', metaSortKey: 1 });
    const elsewhere = await models.requestGroup.create({ parentId: other._id, name: 'Elsewhere' });
    for (let i = 0; i < 6; i++) {
      await models.request.create({ parentId: [workspace._id, folder._id, inner._id][i % 3], name: `Request ${i}`, metaSortKey: i, url: `http://x/${i}` });
    }
    await models.grpcRequest.create({ parentId: folder._id, name: 'gRPC', metaSortKey: 9 });
    await models.webSocketRequest.create({ parentId: inner._id, name: 'WS', metaSortKey: 10 });
    return { project, workspace, other, folder, inner, elsewhere };
  };

  it('gives what reading it all gives, after any kind of change', async () => {
    const { project, workspace, other, folder, inner, elsewhere } = await setUp();
    const parents = [workspace._id, folder._id, inner._id];
    const requests = async () => [
      ...await database.find<BaseModel>(models.request.type, {}),
      ...await database.find<BaseModel>(models.grpcRequest.type, {}),
      ...await database.find<BaseModel>(models.webSocketRequest.type, {}),
    ];
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const pick = <T, >(list: T[]) => list[random(list.length)];
    const someRequest = async () => pick(await models.request.all());
    const changes: [string, () => Promise<unknown>][] = [
      ['edit a url', async () => {
        const request = await someRequest();
        if (request) {
          await models.request.update(request, { url: `http://x/${random(1000)}` });
        }
      }],
      ['rename', async () => {
        const request = await someRequest();
        if (request) {
          await models.request.update(request, { name: `Renamed ${random(1000)}` });
        }
      }],
      ['reorder', async () => {
        const request = await someRequest();
        if (request) {
          await models.request.update(request, { metaSortKey: random(20) - 10 });
        }
      }],
      ['move to another folder', async () => {
        const request = pick(await requests());
        if (request) {
          await database.update({ ...request, parentId: pick(parents) });
        }
      }],
      ['move to another workspace, or back', async () => {
        const request = pick(await requests());
        if (request) {
          await database.update({ ...request, parentId: pick([other._id, elsewhere._id, ...parents]) });
        }
      }],
      ['create', async () => {
        await models.request.create({ parentId: pick(parents), name: `New ${random(1000)}`, metaSortKey: random(20) });
      }],
      ['create elsewhere', async () => {
        await models.request.create({ parentId: pick([other._id, elsewhere._id]), name: 'Not here' });
      }],
      ['delete', async () => {
        const request = pick(await requests());
        if (request) {
          await database.remove(request);
        }
      }],
      ['pin', async () => {
        const request = await someRequest();
        if (request) {
          await models.requestMeta.updateOrCreateByParentId(request._id, { pinned: random(2) === 0 });
        }
      }],
      ['open (lastActive)', async () => {
        const request = await someRequest();
        if (request) {
          await models.requestMeta.updateOrCreateByParentId(request._id, { lastActive: Date.now() });
        }
      }],
      ['pin a gRPC request', async () => {
        const request = (await models.grpcRequest.all())[0];
        if (request) {
          await models.grpcRequestMeta.updateOrCreateByParentId(request._id, { pinned: random(2) === 0 });
        }
      }],
      ['collapse a folder', async () => {
        const parentId = pick([folder._id, inner._id]);
        const meta = await models.requestGroupMeta.getByParentId(parentId);
        const collapsed = random(2) === 0;
        await (meta ? models.requestGroupMeta.update(meta, { collapsed }) : models.requestGroupMeta.create({ parentId, collapsed }));
      }],
      ['rename a folder', async () => {
        const group = pick(await models.requestGroup.findByParentId(workspace._id));
        if (group) {
          await models.requestGroup.update(group, { name: `Folder ${random(1000)}` });
        }
      }],
      ['something else', async () => {
        const request = await someRequest();
        if (request) {
          await models.response.create({ parentId: request._id, statusCode: 200 });
        }
        await models.workspaceMeta.updateByParentId(workspace._id, { activeRequestId: null });
      }],
    ];

    for (const search of ['', '?filter=request', '?sortOrder=name-asc']) {
      await load(project._id, workspace._id, search);
      for (let step = 0; step < 60; step++) {
        const [name, change] = pick(changes);
        await change();
        const incremental = shape(await load(project._id, workspace._id, search));
        forgetCollectionRead();
        const full = shape(await load(project._id, workspace._id, search));
        expect({ step, name, ...incremental }).toEqual({ step, name, ...full });
      }
    }
  });

  it('reads only the request edited', async () => {
    const { project, workspace } = await setUp();
    await load(project._id, workspace._id);
    const request = (await models.request.all())[0];
    await models.request.update(request, { url: 'http://edited' });
    const find = jest.spyOn(database, 'find');

    const { collection } = await load(project._id, workspace._id);

    const treeReads = find.mock.calls.filter(([type]) => [models.request.type, models.requestGroup.type, models.requestMeta.type].includes(type));
    expect(treeReads).toEqual([[models.request.type, { _id: { $in: [request._id] } }]]);
    expect(collection.find(child => child.doc._id === request._id)?.doc).toMatchObject({ url: 'http://edited' });
    find.mockRestore();
  });

  it('reads it all again when the database cannot say what changed', async () => {
    const { project, workspace } = await setUp();
    await load(project._id, workspace._id);
    const request = (await models.request.all())[0];
    await models.request.update(request, { name: 'Changed' });
    const changesSince = jest.spyOn(database, 'changesSince').mockImplementationOnce(async () => ({ stamp: { epoch: 'x', version: 0 }, changes: null }));

    const { collection } = await load(project._id, workspace._id);

    expect(collection.find(child => child.doc._id === request._id)?.doc.name).toBe('Changed');
    changesSince.mockRestore();
  });
});
