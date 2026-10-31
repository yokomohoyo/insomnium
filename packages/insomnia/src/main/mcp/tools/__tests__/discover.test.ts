import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { INSTRUCTIONS, INSTRUCTIONS_URI, registerInstructions } from '../../instructions';
import { registerTools } from '../index';
import { registerDiscoveryTools } from '../discover';
import { registerGitTools } from '../git';
import { registerMockTools } from '../mocks';
import { registerStreamTools } from '../streams';
import { registerTestRunTools } from '../test-run';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerDiscoveryTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the discovery tools', () => {
  let shopId: string;
  let ordersId: string;
  let listId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    shopId = (await models.workspace.create({ name: 'Shop' }))._id;
    ordersId = (await models.requestGroup.create({ parentId: shopId, name: 'Orders' }))._id;
    const archive = await models.requestGroup.create({ parentId: ordersId, name: 'Archive' });
    listId = (await models.request.create({ parentId: archive._id, name: 'List orders', method: 'GET', url: 'https://shop.example.com/orders?page={{ page }}' }))._id;
    await models.request.create({ parentId: shopId, name: 'Create user', method: 'POST', url: 'https://shop.example.com/users' });
    await models.webSocketRequest.create({ parentId: shopId, name: 'Order feed', url: 'wss://shop.example.com/orders' });
    const base = await models.environment.getOrCreateForParentId(shopId);
    await models.environment.update(base, { data: { page: 2 } });
    await models.environment.create({ parentId: base._id, name: 'Orders staging' });
    const other = await models.workspace.create({ name: 'Orders archive' });
    await models.request.create({ parentId: other._id, name: 'Old', method: 'GET', url: 'https://old.example.com/x' });
  });

  it('search finds requests by name, URL or method, and folders, workspaces and environments by name, saying where each is', async () => {
    const { body } = await call('search', { query: 'ORDER', limit: 50 });
    expect(body.total).toBe(5);
    expect(body.results).toEqual(expect.arrayContaining([
      { id: listId, kind: 'request', name: 'List orders', type: 'HTTP', method: 'GET', url: 'https://shop.example.com/orders?page={{ page }}', where: 'Shop / Orders / Archive' },
      expect.objectContaining({ kind: 'request', name: 'Order feed', type: 'WebSocket', where: 'Shop' }),
      { id: ordersId, kind: 'folder', name: 'Orders', where: 'Shop' },
      expect.objectContaining({ kind: 'workspace', name: 'Orders archive', where: '' }),
      expect.objectContaining({ kind: 'environment', name: 'Orders staging', where: 'Shop' }),
    ]));
    // by method, and limited to one workspace
    expect((await call('search', { query: 'post', limit: 50 })).body.results.map((result: { name: string }) => result.name)).toEqual(['Create user']);
    expect((await call('search', { query: 'order', workspaceId: shopId, limit: 50 })).body.results.map((result: { kind: string }) => result.kind)).not.toContain('workspace');
    expect((await call('search', { query: 'order', limit: 2 })).body).toMatchObject({ total: 5, results: [expect.anything(), expect.anything()] });
    expect(await call('search', { query: 'x', workspaceId: 'wrk_nope', limit: 50 })).toEqual({ body: { error: 'workspace not found' }, isError: true });
  });

  it('generate_code writes a request as code, rendered in the active environment', async () => {
    const { body } = await call('generate_code', { requestId: listId, target: 'shell' });
    expect(body).toMatchObject({ target: 'shell', client: 'curl' });
    expect(body.code).toMatch(/^curl /);
    expect(body.code).toContain('https://shop.example.com/orders?page=2');

    const python = (await call('generate_code', { requestId: listId, target: 'python', client: 'requests' })).body;
    expect(python.code).toContain('import requests');
  });

  it('generate_code lists the targets or clients there are when one is wrong', async () => {
    const wrongTarget = await call('generate_code', { requestId: listId, target: 'cobol' });
    expect(wrongTarget.isError).toBe(true);
    expect(wrongTarget.body.targets).toEqual(expect.arrayContaining([{ target: 'shell', clients: expect.arrayContaining(['curl', 'wget']) }]));
    const wrongClient = await call('generate_code', { requestId: listId, target: 'shell', client: 'telnet' });
    expect(wrongClient.body).toMatchObject({ error: "no client 'telnet' for shell", clients: expect.arrayContaining(['curl']) });
    expect(await call('generate_code', { requestId: 'req_nope', target: 'shell' })).toEqual({ body: { error: 'HTTP request not found' }, isError: true });
  });
});

describe('the instructions', () => {
  it('are served as a resource, and name only tools there are', async () => {
    let read: ((uri: URL) => Promise<{ contents: { uri: string; text: string }[] }>) | undefined;
    registerInstructions({ resource: (_name: string, uri: string, _meta: unknown, handler: typeof read) => {
      expect(uri).toBe(INSTRUCTIONS_URI);
      read = handler;
    } } as any);
    const { contents } = await read!(new URL(INSTRUCTIONS_URI));
    expect(contents[0]).toMatchObject({ uri: INSTRUCTIONS_URI, text: INSTRUCTIONS });

    const tools = new Set<string>();
    registerTools({ tool: (name: string) => tools.add(name) } as any);
    // and the app's own, which the app's server adds
    registerTestRunTools({ tool: (name: string) => tools.add(name) } as any, async () => false);
    registerMockTools({ tool: (name: string) => tools.add(name) } as any, {} as any);
    registerGitTools({ tool: (name: string) => tools.add(name) } as any, {} as any);
    registerStreamTools({ tool: (name: string) => tools.add(name) } as any, {} as any);
    const named = [...INSTRUCTIONS.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(match => match[1]);
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter(name => !tools.has(name))).toEqual([]);
  });
});
