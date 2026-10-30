import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import { database } from '../../../../common/database';
import * as models from '../../../../models';
import { DEFAULT_PROJECT_ID } from '../../../../models/project';
import { registerWorkspaceAdminTools } from '../workspace-admin';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerWorkspaceAdminTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the workspace admin tools', () => {
  let projectId: string;
  let otherProjectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    projectId = (await models.project.create({ name: 'Shop' }))._id;
    otherProjectId = (await models.project.create({ name: 'Archive' }))._id;
    workspaceId = (await models.workspace.create({ name: 'Shop API', scope: 'design', parentId: projectId }))._id;
    await models.apiSpec.updateOrCreateForParentId(workspaceId, { fileName: 'Shop API', contents: 'openapi: 3.0.3\n' });
    await models.request.create({ parentId: workspaceId, name: 'Orders' });
  });

  it("rename a design document, and its spec's file with it", async () => {
    expect((await call('update_workspace', { workspaceId, name: 'Store API', description: 'the store' })).body).toEqual({ ok: true, id: workspaceId, name: 'Store API', scope: 'design', parentId: projectId });
    expect(await models.workspace.getById(workspaceId)).toMatchObject({ description: 'the store' });
    expect((await models.apiSpec.getByParentId(workspaceId))?.fileName).toBe('Store API');
  });

  it('move a workspace to another project, and convert it', async () => {
    expect((await call('update_workspace', { workspaceId, projectId: otherProjectId, scope: 'collection' })).body).toMatchObject({ parentId: otherProjectId, scope: 'collection' });
    // the spec is kept
    expect((await models.apiSpec.getByParentId(workspaceId))?.contents).toBe('openapi: 3.0.3\n');

    const collectionId = (await models.workspace.create({ name: 'Shop', scope: 'collection', parentId: projectId }))._id;
    await call('update_workspace', { workspaceId: collectionId, scope: 'design' });
    expect(await models.apiSpec.getByParentId(collectionId)).toMatchObject({ fileName: 'Shop' });

    expect(await call('update_workspace', { workspaceId, projectId: 'proj_nope' })).toEqual({ body: { error: 'project proj_nope not found - use list_projects to see valid ids' }, isError: true });
    expect(await call('update_workspace', { workspaceId: 'wrk_nope', name: 'x' })).toEqual({ body: { error: 'workspace not found' }, isError: true });
  });

  it('copy a workspace with what is in it, into another project', async () => {
    const copy = (await call('duplicate_workspace', { workspaceId, projectId: otherProjectId })).body;
    expect(copy).toMatchObject({ ok: true, name: 'Shop API (Copy)', scope: 'design', parentId: otherProjectId });
    expect((await database.findDescendants(copy.id, [models.request.type])).map(doc => doc.name)).toEqual(['Orders']);
    expect(await models.apiSpec.getByParentId(copy.id)).toMatchObject({ fileName: 'Shop API (Copy)', contents: 'openapi: 3.0.3\n' });
    expect(await models.workspaceMeta.getByParentId(copy.id)).toBeTruthy();

    expect((await call('duplicate_workspace', { workspaceId, name: 'Shop API v2' })).body).toMatchObject({ name: 'Shop API v2', parentId: projectId });
  });

  it('rename a project, and delete it only when it is empty', async () => {
    expect((await call('update_project', { projectId, name: 'Store' })).body).toEqual({ ok: true, id: projectId, name: 'Store' });
    expect((await models.project.getById(projectId))?.name).toBe('Store');

    const refused = await call('delete_project', { projectId });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toBe('the project still has 1 workspace(s): move or delete them first');
    expect(await models.project.getById(projectId)).toBeTruthy();

    expect((await call('delete_project', { projectId: otherProjectId })).body).toEqual({ ok: true, id: otherProjectId });
    expect(await models.project.getById(otherProjectId)).toBeNull();
    expect(await call('delete_project', { projectId: DEFAULT_PROJECT_ID })).toEqual({ body: { error: 'the default project cannot be deleted' }, isError: true });
  });
});
