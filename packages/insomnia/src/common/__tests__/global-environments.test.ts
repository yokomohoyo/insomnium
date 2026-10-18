import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { runAfterResponseScript, runPreRequestScript } from '../../scripting/request-scripts';
import { convert as convertPostmanEnvironment } from '../../utils/importers/importers/postman-env';
import { getGlobalEnvironments, importGlobalEnvironments } from '../global-environments';
import { importToWorkspace } from '../import';
import { getRenderedRequestAndContext } from '../render';

describe('global environments', () => {
  let projectId: string;
  let workspaceId: string;
  let globalBaseId: string;
  let stagingId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    projectId = (await models.project.create({ name: 'Shop' }))._id;
    workspaceId = (await models.workspace.create({ name: 'Orders', parentId: projectId }))._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { host: 'orders.example.com', team: 'orders' } });
    const globalBase = await models.environment.getOrCreateForParentId(projectId);
    globalBaseId = globalBase._id;
    await models.environment.update(globalBase, { data: { team: 'everyone', token: 'base-token', region: 'eu' } });
    stagingId = (await models.environment.create({ parentId: globalBaseId, name: 'Staging', data: { token: 'staging-token' } }))._id;
  });

  const render = async (url: string) => {
    const request = await models.request.create({ parentId: workspaceId, url });
    return (await getRenderedRequestAndContext({ request })).request.url;
  };

  it("render under the collection's own environments, the global sub environment in use over the global base", async () => {
    expect(await render('https://{{ host }}/{{ team }}/{{ token }}/{{ region }}')).toBe('https://orders.example.com/orders/base-token/eu');

    await models.workspaceMeta.getOrCreateByParentId(workspaceId);
    await models.workspaceMeta.updateByParentId(workspaceId, { activeGlobalEnvironmentId: stagingId });
    expect(await render('https://{{ host }}/{{ team }}/{{ token }}/{{ region }}')).toBe('https://orders.example.com/orders/staging-token/eu');
  });

  it("are the project's: a collection in another project, or another project's sub environment, gets none of them", async () => {
    const elsewhere = (await models.project.create({ name: 'Other' }))._id;
    const otherWorkspace = (await models.workspace.create({ name: 'Other', parentId: elsewhere }))._id;
    const otherGlobal = await models.environment.getOrCreateForParentId(elsewhere);
    await models.workspaceMeta.getOrCreateByParentId(workspaceId);
    await models.workspaceMeta.updateByParentId(workspaceId, { activeGlobalEnvironmentId: (await models.environment.create({ parentId: otherGlobal._id, name: 'Theirs' }))._id });

    expect(await getGlobalEnvironments(projectId, workspaceId)).toEqual({ base: expect.objectContaining({ _id: globalBaseId }), active: null });
    expect(await getGlobalEnvironments(elsewhere, otherWorkspace)).toEqual({ base: expect.objectContaining({ _id: otherGlobal._id }), active: null });
  });

  it("are a script's globals: read with the rest, and kept in the global environment in use", async () => {
    await models.workspaceMeta.getOrCreateByParentId(workspaceId);
    await models.workspaceMeta.updateByParentId(workspaceId, { activeGlobalEnvironmentId: stagingId });
    const request = await models.request.create({
      parentId: workspaceId,
      url: 'https://{{ host }}/{{ seen }}',
      preRequestScript: "insomnia.variables.set('seen', [pm.globals.get('token'), insomnia.variables.get('region'), insomnia.variables.get('team')].join(','));",
      afterResponseScript: "pm.globals.set('lastStatus', 200);",
    });
    const { variables } = await runPreRequestScript(request);
    expect(variables.seen).toBe('staging-token,eu,orders');

    await runAfterResponseScript(request, { statusCode: 200, statusMessage: 'OK', headers: [], bodyPath: '', bytesContent: 0, elapsedTime: 1 } as any);
    expect((await models.environment.getById(stagingId))?.data).toEqual({ token: 'staging-token', lastStatus: 200 });
    expect((await models.environment.getById(globalBaseId))?.data).toEqual({ team: 'everyone', token: 'base-token', region: 'eu' });
  });

  it("take Postman's globals on import, over what they had, and leave the collection alone", async () => {
    const resources = await convertPostmanEnvironment(JSON.stringify({
      name: 'My Workspace Globals',
      _postman_variable_scope: 'globals',
      values: [{ key: 'region', value: 'us', enabled: true }, { key: 'requestId', value: '{{$guid}}', enabled: true }, { key: 'off', value: 'x', enabled: false }],
    })) || [];
    const scanned = resources.map(({ _type, ...resource }) => ({ ...resource, type: models.environment.type })) as any[];

    expect(await importGlobalEnvironments(projectId, scanned)).toEqual([]);
    await importToWorkspace({ workspaceId, resources: scanned });
    expect((await models.environment.getById(globalBaseId))?.data).toEqual({ team: 'everyone', token: 'base-token', region: 'us', requestId: "{% faker 'guid' %}" });
    expect(await models.environment.findByParentId((await models.environment.getOrCreateForParentId(workspaceId))._id)).toEqual([]);
  });
});
