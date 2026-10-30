import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import { database } from '../../../../common/database';
import * as models from '../../../../models';
import { registerDesignTools } from '../design';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerDesignTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

const SPEC = 'openapi: 3.0.3\ninfo:\n  title: Shop\n  version: 1.0.0\npaths: {}\n';

describe('the design tools', () => {
  let workspaceId: string;
  let requestId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Shop API', scope: 'design' }))._id;
    requestId = (await models.request.create({ parentId: workspaceId, name: 'Orders', url: 'https://shop.example.com/orders' }))._id;
  });

  it("read and set a design document's spec", async () => {
    // a design document made without one (as before #312) gets its spec
    expect((await call('get_spec', { workspaceId })).body).toMatchObject({ workspaceId, contentType: 'yaml', contents: '' });

    expect((await call('set_spec', { workspaceId, contents: SPEC })).body).toMatchObject({ ok: true, contentType: 'yaml' });
    expect((await call('get_spec', { workspaceId })).body).toMatchObject({ contents: SPEC, contentType: 'yaml' });
    expect((await models.apiSpec.all()).filter(spec => spec.parentId === workspaceId)).toHaveLength(1);

    expect((await call('set_spec', { workspaceId, contents: '{"openapi": "3.0.3"}' })).body).toMatchObject({ ok: true, contentType: 'json' });
    expect((await models.apiSpec.getByParentId(workspaceId))?.contents).toBe('{"openapi": "3.0.3"}');
  });

  it("refuse a spec that isn't YAML or JSON, or a collection's", async () => {
    await call('set_spec', { workspaceId, contents: SPEC });
    const bad = await call('set_spec', { workspaceId, contents: 'a: [1, 2' });
    expect(bad.isError).toBe(true);
    expect(bad.body).toMatchObject({ error: 'the spec is not YAML or JSON', parseError: expect.any(String) });
    expect((await models.apiSpec.getByParentId(workspaceId))?.contents).toBe(SPEC);

    const collectionId = (await models.workspace.create({ name: 'Shop', scope: 'collection' }))._id;
    expect(await call('get_spec', { workspaceId: collectionId })).toEqual({ body: { error: 'workspaceId is not a design document' }, isError: true });
    expect(await call('set_spec', { workspaceId: collectionId, contents: SPEC })).toEqual({ body: { error: 'workspaceId is not a design document' }, isError: true });
    expect(await models.apiSpec.getByParentId(collectionId)).toBeNull();
  });

  it('make test suites and their tests, change them and delete them', async () => {
    const suite = (await call('create_test_suite', { workspaceId, name: 'Orders' })).body;
    expect(suite).toMatchObject({ ok: true, name: 'Orders' });
    const code = 'const response = await insomnia.send();\nexpect(response.status).to.equal(200);';
    const test = (await call('create_unit_test', { suiteId: suite.id, name: 'lists orders', code, requestId })).body;
    expect(test).toMatchObject({ ok: true, name: 'lists orders' });
    expect((await call('list_test_suites', { workspaceId })).body).toEqual([{ id: suite.id, name: 'Orders', tests: [{ id: test.id, name: 'lists orders', requestId, code }] }]);

    await call('update_unit_test', { testId: test.id, name: 'still lists orders', requestId: null });
    expect((await call('list_test_suites', { workspaceId })).body[0].tests[0]).toEqual({ id: test.id, name: 'still lists orders', requestId: null, code });

    expect(await call('create_unit_test', { suiteId: suite.id, name: 'x', code, requestId: 'req_nope' })).toEqual({ body: { error: 'request not found' }, isError: true });
    expect(await call('create_unit_test', { suiteId: 'uts_nope', name: 'x', code })).toEqual({ body: { error: 'test suite not found' }, isError: true });

    expect((await call('delete_unit_test', { testId: test.id })).body).toEqual({ ok: true, id: test.id });
    expect((await call('list_test_suites', { workspaceId })).body[0].tests).toEqual([]);

    const again = (await call('create_unit_test', { suiteId: suite.id, name: 'again', code })).body;
    expect((await call('delete_test_suite', { suiteId: suite.id })).body).toEqual({ ok: true, id: suite.id });
    expect((await call('list_test_suites', { workspaceId })).body).toEqual([]);
    // its tests went with it
    expect(await database.getWhere(models.unitTest.type, { _id: again.id })).toBeNull();
  });

  it('make flows, with a graph or just their start, and change and delete them', async () => {
    const empty = (await call('create_flow', { workspaceId, name: 'Empty' })).body;
    expect(empty).toMatchObject({ ok: true, name: 'Empty' });
    expect(empty.problem).toBeUndefined();

    const graph = {
      nodes: [
        { id: 'start', kind: 'start', data: {} },
        { id: 'list', kind: 'request', data: { requestId } },
        { id: 'ok', kind: 'condition', data: { source: 'status', operator: 'equals', value: '200' } },
        { id: 'wait', kind: 'delay', data: { milliseconds: 10 } },
      ],
      edges: [
        { source: 'start', target: 'list' },
        { source: 'list', target: 'ok' },
        { source: 'ok', target: 'wait', sourceHandle: 'true' },
      ],
    };
    const created = (await call('create_flow', { workspaceId, name: 'Orders', description: 'lists orders', graph })).body;
    expect(created.problem).toBeUndefined();
    const flow = (await call('get_flow', { flowId: created.id })).body;
    expect(flow).toMatchObject({ id: created.id, workspaceId, name: 'Orders', description: 'lists orders' });
    // positions and edge ids made up, as the canvas needs them
    expect(flow.graph.nodes[1]).toEqual({ id: 'list', kind: 'request', position: { x: 250, y: 0 }, data: { requestId } });
    expect(flow.graph.edges.map((edge: { id: string }) => edge.id)).toEqual(['e0-start-list', 'e1-list-ok', 'e2-ok-wait']);
    expect((await call('list_flows', { workspaceId })).body).toEqual(expect.arrayContaining([
      { id: created.id, name: 'Orders', description: 'lists orders', steps: 4 },
      { id: empty.id, name: 'Empty', description: '', steps: 1 },
    ]));

    // two ways out of a request is a problem, reported but kept, as the canvas keeps it
    const forked = await call('update_flow', { flowId: created.id, name: 'Forked', graph: { ...graph, edges: [...graph.edges, { source: 'list', target: 'wait' }] } });
    expect(forked.body).toMatchObject({ ok: true, problem: 'A step has one arrow out of it: add a condition to go two ways.' });
    expect(await models.flow.getById(created.id)).toMatchObject({ name: 'Forked', description: 'lists orders' });

    expect((await call('delete_flow', { flowId: created.id })).body).toEqual({ ok: true, id: created.id });
    expect(await call('get_flow', { flowId: created.id })).toEqual({ body: { error: 'flow not found' }, isError: true });
    expect(await call('create_flow', { workspaceId: 'wrk_nope', name: 'x' })).toEqual({ body: { error: 'workspace not found' }, isError: true });
  });
});
