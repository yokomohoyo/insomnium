import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as apiSpecs from '../../../common/api-specs';
import { database } from '../../../common/database';
import * as models from '../../../models';
import { DEFAULT_ORGANIZATION_ID } from '../../../models/organization';
import { loader, type ProjectLoaderData } from '../project';

// more ids than the mocked list has
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

describe('the projects page loader', () => {
  beforeEach(globalBeforeEach);
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('gives each workspace its own meta, certificates and spec, in as many queries for a hundred workspaces as for one', async () => {
    const project = await models.project.create({ name: 'Project' });
    const plain = await models.workspace.create({ name: 'Plain', parentId: project._id });
    const full = await models.workspace.create({ name: 'Full', scope: 'design', parentId: project._id });
    await models.workspaceMeta.create({ parentId: full._id, cachedGitRepositoryBranch: 'dev' });
    const certs = [
      await models.clientCertificate.create({ parentId: full._id, host: 'a.example.com' }),
      await models.clientCertificate.create({ parentId: full._id, host: 'b.example.com' }),
    ];
    const ca = await models.caCertificate.create({ parentId: full._id, path: '/ca.pem' });
    const spec = await models.apiSpec.getOrCreateForParentId(full._id);
    await models.apiSpec.update(spec, { contents: 'openapi: 3.0.0\ninfo:\n  title: Pets\n  version: 4.0.0\npaths: {}\n' });

    const queries = jest.spyOn(database, 'find');
    const { workspaces } = await load(project._id);
    const one = queries.mock.calls.length;

    const byName = Object.fromEntries(workspaces.map(w => [w.name, w]));    expect(byName.Full).toMatchObject({
      specVersion: '4.0.0',
      lastActiveBranch: 'dev',
      clientCertificates: certs,
      caCertificate: ca,
      modifiedLocally: (await models.apiSpec.getByParentId(full._id))!.modified,
    });
    expect(byName.Plain).toMatchObject({ specVersion: null, clientCertificates: [], caCertificate: null });
    // a workspace without a meta gets one, as before
    expect(byName.Plain.workspaceMeta).toEqual(await models.workspaceMeta.getByParentId(plain._id));

    for (let i = 0; i < 100; i++) {
      await models.workspace.create({ name: `More ${i}`, parentId: project._id });
    }
    await load(project._id);
    queries.mockClear();
    await load(project._id);
    // and the spec, unchanged, isn't read again
    expect(queries.mock.calls.length).toBeLessThanOrEqual(one);
    expect(queries.mock.calls.some(([type]) => type === models.apiSpec.type)).toBe(false);
  });
});
