import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { workspaceLoader, type WorkspaceLoaderData } from '../workspace';

describe('workspaceLoader', () => {
  beforeEach(globalBeforeEach);

  const load = async (projectId: string, workspaceId: string, search = '') =>
    await workspaceLoader({ request: { url: `http://localhost/${search}` }, params: { projectId, workspaceId } } as any) as WorkspaceLoaderData;

  it('gives the tree of folders and requests, in order, with what is pinned and collapsed', async () => {
    const project = await models.project.create({ name: 'Project' });
    const workspace = await models.workspace.create({ name: 'Workspace', parentId: project._id });
    const outer = await models.requestGroup.create({ parentId: workspace._id, name: 'Outer', metaSortKey: 0 });
    const inner = await models.requestGroup.create({ parentId: outer._id, name: 'Inner', metaSortKey: 1 });
    const closed = await models.requestGroup.create({ parentId: workspace._id, name: 'Closed', metaSortKey: 1 });
    await models.requestGroupMeta.create({ parentId: closed._id, collapsed: true });
    const second = await models.request.create({ parentId: outer._id, name: 'Second', metaSortKey: 2, url: 'http://b' });
    const first = await models.request.create({ parentId: outer._id, name: 'First', metaSortKey: 0, url: 'http://a' });
    await models.requestMeta.create({ parentId: first._id, pinned: true });
    await models.request.create({ parentId: inner._id, name: 'Deep', metaSortKey: 0 });
    await models.request.create({ parentId: closed._id, name: 'Hidden', metaSortKey: 0 });
    await models.request.create({ parentId: workspace._id, name: 'Top', metaSortKey: 2 });

    const { requestTree, collection } = await load(project._id, workspace._id);

    const shape = (children: WorkspaceLoaderData['requestTree']): unknown[] =>
      children.map(({ doc, children, pinned, collapsed, hidden, level }) => [doc.name, { pinned, collapsed, hidden, level }, ...(children.length ? [shape(children)] : [])]);
    expect(shape(requestTree)).toEqual([
      ['Outer', { pinned: false, collapsed: false, hidden: false, level: 0 }, [
        ['First', { pinned: true, collapsed: false, hidden: false, level: 1 }],
        ['Inner', { pinned: false, collapsed: false, hidden: false, level: 1 }, [
          ['Deep', { pinned: false, collapsed: false, hidden: false, level: 2 }],
        ]],
        ['Second', { pinned: false, collapsed: false, hidden: false, level: 1 }],
      ]],
      ['Closed', { pinned: false, collapsed: true, hidden: false, level: 0 }, [
        ['Hidden', { pinned: false, collapsed: true, hidden: true, level: 1 }],
      ]],
      ['Top', { pinned: false, collapsed: false, hidden: false, level: 0 }],
    ]);
    expect(collection.map(child => child.doc.name)).toEqual(['Outer', 'First', 'Inner', 'Deep', 'Second', 'Closed', 'Hidden', 'Top']);
    expect(collection.find(child => child.doc._id === second._id)?.ancestors).toEqual([workspace._id, outer._id]);
  });

  it('hides what the filter does not match, and opens collapsed folders for it', async () => {
    const project = await models.project.create({ name: 'Project' });
    const workspace = await models.workspace.create({ name: 'Workspace', parentId: project._id });
    const closed = await models.requestGroup.create({ parentId: workspace._id, name: 'Closed' });
    await models.requestGroupMeta.create({ parentId: closed._id, collapsed: true });
    await models.request.create({ parentId: closed._id, name: 'Needle', metaSortKey: 0 });
    await models.request.create({ parentId: closed._id, name: 'Other', metaSortKey: 1 });

    const { collection } = await load(project._id, workspace._id, '?filter=needle');

    expect(collection.map(({ doc, hidden, collapsed }) => [doc.name, hidden, collapsed])).toEqual([
      ['Closed', true, false],
      ['Needle', false, false],
      ['Other', true, false],
    ]);
  });
});
