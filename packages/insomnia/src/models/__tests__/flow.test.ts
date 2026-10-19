import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import { database as db } from '../../common/database';
import { exportWorkspacesData } from '../../common/export-data';
import { scanResources } from '../../common/import';
import { importResourcesToProject } from '../../common/importResourcesToProject';
import type { FlowGraph } from '../../flows/run-flow';
import * as models from '../index';
import { DEFAULT_PROJECT_ID } from '../project';

// a flow that sends one request
const sends = (requestId: string): FlowGraph => ({
  nodes: [
    { id: 'start', kind: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'send', kind: 'request', position: { x: 260, y: 0 }, data: { requestId } },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'send' }],
});

describe('flows', () => {
  beforeEach(globalBeforeEach);

  it('start with their Flow Start', async () => {
    const workspace = await models.workspace.create({ name: 'Pets' });
    const flow = await models.flow.create({ parentId: workspace._id });
    expect(flow.graph).toEqual({ nodes: [{ id: 'start', kind: 'start', position: { x: 0, y: 0 }, data: {} }], edges: [] });
  });

  it('of a duplicated workspace send its copies of the requests, as its unit tests do', async () => {
    const workspace = await models.workspace.create({ name: 'Pets', parentId: DEFAULT_PROJECT_ID });
    const request = await models.request.create({ parentId: workspace._id, name: 'pet' });
    await models.flow.create({ parentId: workspace._id, name: 'flow', graph: sends(request._id) });
    const suite = await models.unitTestSuite.create({ parentId: workspace._id });
    await models.unitTest.create({ parentId: suite._id, requestId: request._id });

    const copy = await db.duplicate(workspace, { name: 'Copy' });
    const copiedRequest = (await models.request.findByParentId(copy._id))[0];
    const copiedFlow = (await models.flow.findByParentId(copy._id))[0];
    const copiedSuite = (await models.unitTestSuite.findByParentId(copy._id))[0];
    const copiedTest = await models.unitTest.getByParentId(copiedSuite._id);
    expect(copiedRequest._id).not.toBe(request._id);
    expect(copiedFlow.graph.nodes[1].data.requestId).toBe(copiedRequest._id);
    expect(copiedTest?.requestId).toBe(copiedRequest._id);

    // the original's are as they were
    const flow = (await models.flow.findByParentId(workspace._id))[0];
    expect(flow.graph.nodes[1].data.requestId).toBe(request._id);
  });

  it('are exported with their collection, and imported sending its new requests', async () => {
    const workspace = await models.workspace.create({ name: 'Pets', parentId: DEFAULT_PROJECT_ID });
    const request = await models.request.create({ parentId: workspace._id, name: 'pet' });
    await models.flow.create({ parentId: workspace._id, name: 'flow', graph: sends(request._id) });

    const exported = await exportWorkspacesData([workspace], false, 'json');
    expect(JSON.parse(exported).resources).toEqual(expect.arrayContaining([expect.objectContaining({ _type: 'flow', name: 'flow' })]));

    await scanResources({ content: exported });
    await importResourcesToProject({ projectId: DEFAULT_PROJECT_ID });
    const importedWorkspace = (await models.workspace.findByParentId(DEFAULT_PROJECT_ID)).find(candidate => candidate._id !== workspace._id);
    expect(importedWorkspace).toBeTruthy();
    const importedRequest = (await models.request.findByParentId(importedWorkspace!._id))[0];
    const importedFlow = (await models.flow.findByParentId(importedWorkspace!._id))[0];
    expect(importedRequest._id).not.toBe(request._id);
    expect(importedFlow.graph.nodes[1].data.requestId).toBe(importedRequest._id);
  });
});
