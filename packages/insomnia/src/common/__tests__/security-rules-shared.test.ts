import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { exportWorkspacesData } from '../export-data';
import { importResourcesToNewWorkspace } from '../importResourcesToNewWorkspace';
import { moveIgnoredSecurityRules } from '../security-rules-moved';

// The Security tab's ignored rules are the collection's own, so that a team
// ignores the same ones: they go where the collection goes
describe("a collection's ignored security rules", () => {
  let projectId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    projectId = (await models.project.create({ name: 'Team' }))._id;
  });

  it('starts with none', async () => {
    expect((await models.workspace.create({ name: 'Shop', parentId: projectId })).securityIgnoredRules).toEqual([]);
  });

  it('are in its export, and come back with an import of it', async () => {
    const workspace = await models.workspace.create({ name: 'Shop', parentId: projectId, securityIgnoredRules: ['nosniff-missing', 'rate-limit'] });
    await models.request.create({ parentId: workspace._id, name: 'List', url: 'https://shop.example.com/orders' });

    const exported = JSON.parse(await exportWorkspacesData([workspace], false, 'json'));
    const resources = exported.resources.map(({ _type, ...resource }: { _type: string }) => ({ ...resource, type: models.MODELS_BY_EXPORT_TYPE[_type]!.type }));

    expect(exported.resources.find(({ _type }: { _type: string }) => _type === 'workspace').securityIgnoredRules).toEqual(['nosniff-missing', 'rate-limit']);

    const { workspace: imported } = await importResourcesToNewWorkspace(projectId, resources, resources.find((resource: { type: string }) => resource.type === 'Workspace'));
    expect(imported._id).not.toBe(workspace._id);
    expect(imported.securityIgnoredRules).toEqual(['nosniff-missing', 'rate-limit']);
  });

  it('are only ever rules: an import brings nothing else in under their name', async () => {
    const { workspace } = await importResourcesToNewWorkspace(projectId, [], { _id: 'wrk_in', type: 'Workspace', name: 'Shop', scope: 'collection', securityIgnoredRules: ['rate-limit', 'made-up', 7, 'rate-limit'] } as any);

    expect(workspace.securityIgnoredRules).toEqual(['rate-limit']);
  });

  it('take over what 0.10 and 0.11 kept on this computer, once, adding to what the collection has', async () => {
    const workspace = await models.workspace.create({ name: 'Shop', parentId: projectId, securityIgnoredRules: ['rate-limit'] });
    await models.workspaceMeta.getOrCreateByParentId(workspace._id);
    const meta = await models.workspaceMeta.updateByParentId(workspace._id, { securityIgnoredRules: ['nosniff-missing', 'rate-limit', 'not-a-rule'] });

    const moved = await moveIgnoredSecurityRules(workspace, meta);

    expect(moved.workspace.securityIgnoredRules).toEqual(['rate-limit', 'nosniff-missing']);
    expect(moved.meta.securityIgnoredRules).toEqual([]);
    expect((await models.workspace.getById(workspace._id))?.securityIgnoredRules).toEqual(['rate-limit', 'nosniff-missing']);
    // and nothing more to do the next time it's opened
    const again = await moveIgnoredSecurityRules(moved.workspace, moved.meta);
    expect(again.workspace).toBe(moved.workspace);
  });

  it('are synced with it: the collection is one of the types Git Sync and a team write out', () => {
    expect(models.workspace.canSync).toBe(true);
    // (and where they were kept on one computer is not)
    expect((models.workspaceMeta as { canSync?: boolean }).canSync).not.toBe(true);
  });
});
