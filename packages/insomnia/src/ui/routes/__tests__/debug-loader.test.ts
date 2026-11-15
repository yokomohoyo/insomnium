import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { loader } from '../debug';

// jsdom has no Response for redirect() to make
jest.mock('react-router-dom', () => ({
  ...(jest.requireActual('react-router-dom') as typeof import('react-router-dom')),
  redirect: (url: string) => ({ redirectedTo: url }),
}));

describe('the requests page loader', () => {
  beforeEach(globalBeforeEach);

  const open = async (create: (workspaceId: string) => Promise<{ _id: string }>) => {
    const workspace = await models.workspace.create({ name: 'Workspace' });
    const request = await create(workspace._id);
    await models.workspaceMeta.getOrCreateByParentId(workspace._id);
    await models.workspaceMeta.updateByParentId(workspace._id, { activeRequestId: request._id });
    const result = await loader({ request: {}, params: { organizationId: 'org', projectId: 'proj', workspaceId: workspace._id } } as any);
    return { result, request };
  };

  it.each([
    ['an HTTP', (parentId: string) => models.request.create({ parentId, name: 'A' })],
    ['a WebSocket', (parentId: string) => models.webSocketRequest.create({ parentId, name: 'A' })],
    ['a gRPC', (parentId: string) => models.grpcRequest.create({ parentId, name: 'A' })],
    ['an MCP', (parentId: string) => models.mcpRequest.create({ parentId, name: 'A' })],
  ])('goes back to the request that was open when it is %s request', async (_kind, create) => {
    const { result, request } = await open(create);
    expect(result).toEqual({ redirectedTo: expect.stringContaining(`/request/${request._id}`) });
  });

  it('stays on the empty page when the request that was open is gone', async () => {
    const workspace = await models.workspace.create({ name: 'Workspace' });
    await models.workspaceMeta.getOrCreateByParentId(workspace._id);
    await models.workspaceMeta.updateByParentId(workspace._id, { activeRequestId: 'req_gone' });
    expect(await loader({ request: {}, params: { organizationId: 'org', projectId: 'proj', workspaceId: workspace._id } } as any)).toBeNull();
  });
});
