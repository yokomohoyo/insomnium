import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerWorkspaceTools } from '../workspaces';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerWorkspaceTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await handlers[name](args)).content[0].text);

describe('the workspace tools', () => {
  let parentId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    parentId = (await models.project.create({ name: 'Shop' }))._id;
  });

  it('create a design doc with its spec, as the app does', async () => {
    const { id } = await call('create_workspace', { name: 'Shop API', scope: 'design', parentId });
    expect(await models.workspace.getById(id)).toEqual(expect.objectContaining({ scope: 'design' }));
    expect(await models.apiSpec.getByParentId(id)).toEqual(expect.objectContaining({ parentId: id }));
    expect(await models.environment.getByParentId(id)).toBeTruthy();
    expect((await models.cookieJar.all()).filter(jar => jar.parentId === id)).toHaveLength(1);
    expect(await models.workspaceMeta.getByParentId(id)).toBeTruthy();
  });

  it('create a collection without a spec', async () => {
    const { id } = await call('create_workspace', { name: 'Shop', scope: 'collection', parentId });
    expect(await models.workspace.getById(id)).toEqual(expect.objectContaining({ scope: 'collection' }));
    expect(await models.apiSpec.getByParentId(id)).toBeNull();
  });

  it('delete a workspace and what is in it, only when its name is repeated', async () => {
    const { id } = await call('create_workspace', { name: 'Shop API', scope: 'design', parentId });
    const folder = await models.requestGroup.create({ parentId: id, name: 'Orders' });
    const request = await models.request.create({ parentId: folder._id, name: 'List orders' });
    const other = (await call('create_workspace', { name: 'Keep me', scope: 'collection', parentId })).id;

    expect(await handlers.delete_workspace({ workspaceId: id, name: 'Shop' })).toMatchObject({ isError: true });
    expect(await models.workspace.getById(id)).toBeTruthy();
    expect(await handlers.delete_workspace({ workspaceId: 'wrk_nope', name: 'Shop API' })).toMatchObject({ isError: true });

    expect(await call('delete_workspace', { workspaceId: id, name: 'Shop API' })).toEqual({ ok: true, workspaceId: id, name: 'Shop API' });
    expect(await models.workspace.getById(id)).toBeNull();
    expect(await models.requestGroup.getById(folder._id)).toBeNull();
    expect(await models.request.getById(request._id)).toBeNull();
    expect(await models.apiSpec.getByParentId(id)).toBeNull();
    expect(await models.workspace.getById(other)).toBeTruthy();
  });
});
