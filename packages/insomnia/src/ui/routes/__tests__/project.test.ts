import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as apiSpecs from '../../../common/api-specs';
import * as models from '../../../models';
import { DEFAULT_ORGANIZATION_ID } from '../../../models/organization';
import { loader, type ProjectLoaderData } from '../project';

describe('the projects page loader', () => {
  beforeEach(globalBeforeEach);

  const load = async (projectId: string) =>
    await loader({ request: { url: 'http://localhost/' }, params: { organizationId: DEFAULT_ORGANIZATION_ID, projectId } } as any) as ProjectLoaderData;

  it("gives a document's spec version and format, not the spec, and parses it again only once it changes", async () => {
    const project = await models.project.create({ name: 'Project' });
    const design = await models.workspace.create({ name: 'Pets', scope: 'design', parentId: project._id });
    const spec = await models.apiSpec.getOrCreateForParentId(design._id);
    await models.apiSpec.update(spec, { contents: 'openapi: 3.0.0\ninfo:\n  title: Pets\n  version: 1.2.0\npaths: {}\n' });
    const parse = jest.spyOn(apiSpecs, 'parseApiSpec');

    const first = (await load(project._id)).workspaces.find(w => w._id === design._id)!;
    expect(first).toMatchObject({ specVersion: '1.2.0', specFormat: 'openapi', specFormatVersion: '3.0.0' });
    expect(first).not.toHaveProperty('apiSpec');
    expect(first).not.toHaveProperty('spec');
    await load(project._id);
    expect(parse).toHaveBeenCalledTimes(1);

    await models.apiSpec.update((await models.apiSpec.getByParentId(design._id))!, { contents: '{"openapi": "3.1.0", "info": {"version": "2"}}', modified: Date.now() + 1000 });
    expect((await load(project._id)).workspaces.find(w => w._id === design._id)).toMatchObject({ specVersion: '2', specFormatVersion: '3.1.0' });
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
