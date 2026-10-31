import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import { database } from '../../../../common/database';
import * as models from '../../../../models';
import { registerFolderTools } from '../folders';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerFolderTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the folder tools', () => {
  let workspaceId: string;
  let ordersId: string;
  let archiveId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    ordersId = (await models.requestGroup.create({ parentId: workspaceId, name: 'Orders' }))._id;
    archiveId = (await models.requestGroup.create({ parentId: ordersId, name: 'Archive' }))._id;
    await models.request.create({ parentId: archiveId, name: 'Old orders' });
  });

  it('rename a folder and move it within its workspace', async () => {
    expect((await call('update_request_group', { requestGroupId: archiveId, name: 'Archived', description: 'old ones' })).body).toEqual({ ok: true, id: archiveId });
    expect(await models.requestGroup.getById(archiveId)).toMatchObject({ name: 'Archived', description: 'old ones', parentId: ordersId });

    await call('update_request_group', { requestGroupId: archiveId, parentId: workspaceId });
    expect((await models.requestGroup.getById(archiveId))?.parentId).toBe(workspaceId);
  });

  it('refuse to move a folder into itself, a folder inside it, or something that is not a workspace or folder', async () => {
    expect(await call('update_request_group', { requestGroupId: ordersId, parentId: archiveId })).toEqual({ body: { error: 'a folder cannot move into itself or a folder inside it' }, isError: true });
    expect(await call('update_request_group', { requestGroupId: ordersId, parentId: ordersId })).toMatchObject({ isError: true });
    expect(await call('update_request_group', { requestGroupId: ordersId, parentId: 'wrk_nope' })).toEqual({ body: { error: 'parentId is not a workspace or a folder' }, isError: true });
    expect((await models.requestGroup.getById(ordersId))?.parentId).toBe(workspaceId);
  });

  it('move a folder, with what is in it, to another workspace or a folder there', async () => {
    const otherId = (await models.workspace.create({ name: 'Other' }))._id;
    expect((await call('update_request_group', { requestGroupId: ordersId, parentId: otherId })).body).toEqual({ ok: true, id: ordersId });
    expect((await models.requestGroup.getById(ordersId))?.parentId).toBe(otherId);
    // its folders and requests come along
    expect((await database.findDescendants(otherId, [models.requestGroup.type, models.request.type])).map(doc => doc.name).sort()).toEqual(['Archive', 'Old orders', 'Orders']);

    const inbox = (await models.requestGroup.create({ parentId: workspaceId, name: 'Inbox' }))._id;
    expect((await call('update_request_group', { requestGroupId: ordersId, parentId: inbox })).body).toEqual({ ok: true, id: ordersId });
    expect((await models.requestGroup.getById(ordersId))?.parentId).toBe(inbox);
  });

  it('copy a folder with what is in it', async () => {
    const copy = (await call('duplicate_request_group', { requestGroupId: ordersId })).body;
    expect(copy).toMatchObject({ ok: true, name: 'Orders (Copy)', parentId: workspaceId });
    const inCopy = await database.findDescendants(copy.id, [models.requestGroup.type, models.request.type]);
    expect(inCopy.map(doc => doc.name).sort()).toEqual(['Archive', 'Old orders']);
  });

  it('delete a folder and what is in it', async () => {
    expect((await call('delete_request_group', { requestGroupId: ordersId })).body).toEqual({ ok: true, id: ordersId });
    expect(await models.requestGroup.getById(archiveId)).toBeNull();
    expect(await database.findDescendants(workspaceId, [models.request.type])).toEqual([]);
    expect(await call('delete_request_group', { requestGroupId: ordersId })).toEqual({ body: { error: 'folder not found' }, isError: true });
  });
});
