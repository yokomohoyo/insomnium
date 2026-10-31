import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';
import http from 'node:http';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import type { MockLogEntry } from '../../../../mock/mock-routes';
import { type MockServer, startMockServer } from '../../../../mock/mock-server';
import * as models from '../../../../models';
import { type MockControls, registerMockTools } from '../mocks';

window.app = electron.app;

// the app's controls (main/mock-servers.ts), without Electron's windows
const running = new Map<string, MockServer>();
const logs = new Map<string, MockLogEntry[]>();
const controls: MockControls = {
  start: async (workspaceId, port) => {
    await running.get(workspaceId)?.close();
    logs.set(workspaceId, []);
    const server = await startMockServer({ workspaceIds: [workspaceId], port, onRequest: entry => logs.get(workspaceId)!.push(entry) });
    running.set(workspaceId, server);
    return { url: server.url, port: server.port };
  },
  stop: async workspaceId => {
    await running.get(workspaceId)?.close();
    running.delete(workspaceId);
  },
  status: workspaceId => {
    const server = running.get(workspaceId);
    return server ? { url: server.url, port: server.port } : null;
  },
  recent: workspaceId => logs.get(workspaceId) || [],
};

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerMockTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, controls);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

const get = (url: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  http.get(url, response => {
    let body = '';
    response.on('data', chunk => body += chunk);
    response.on('end', () => resolve({ status: response.statusCode || 0, body }));
  }).on('error', reject);
});

describe('the mock server tools', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    const order = await models.request.create({ parentId: workspaceId, name: 'Get order', method: 'GET', url: '{{ base }}/orders/:id' });
    await models.responseExample.create({ parentId: order._id, name: 'Found', statusCode: 200, statusMessage: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"id":7}' });
    await models.request.create({ parentId: workspaceId, name: 'No example', method: 'GET', url: '{{ base }}/users' });
  });

  afterEach(async () => {
    await Promise.all([...running.keys()].map(id => controls.stop(id)));
  });

  it("start a collection's mock, list its routes, answer from its examples, and log what it answered", async () => {
    const started = await call('start_mock_server', { workspaceId, port: 0 });
    expect(started.isError).toBe(false);
    expect(started.body).toMatchObject({ url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/), routes: [{ method: 'GET', path: '/orders/:id', request: 'Get order', examples: ['Found (200)'] }] });
    expect(started.body.note).toBeUndefined();

    expect(await get(`${started.body.url}/orders/7`)).toEqual({ status: 200, body: '{"id":7}' });

    const status = (await call('get_mock_server', { workspaceId })).body;
    expect(status).toMatchObject({ running: true, url: started.body.url, routes: [expect.objectContaining({ path: '/orders/:id' })] });
    expect(status.recentRequests).toEqual([expect.objectContaining({ method: 'GET', path: '/orders/7', status: 200, requestName: 'Get order', exampleName: 'Found' })]);

    expect((await call('stop_mock_server', { workspaceId })).body).toEqual({ ok: true, wasRunning: true });
    expect((await call('get_mock_server', { workspaceId })).body).toMatchObject({ running: false, recentRequests: [] });
    expect((await call('stop_mock_server', { workspaceId })).body).toEqual({ ok: true, wasRunning: false });
  });

  it('say when a collection has nothing to answer with, and refuse a workspace that is missing', async () => {
    const empty = (await models.workspace.create({ name: 'Empty' }))._id;
    expect((await call('start_mock_server', { workspaceId: empty, port: 0 })).body).toMatchObject({ routes: [], note: expect.stringContaining('create_response_example') });
    expect(await call('start_mock_server', { workspaceId: 'wrk_nope', port: 0 })).toEqual({ body: { error: 'workspace not found' }, isError: true });
    expect(await call('get_mock_server', { workspaceId: 'wrk_nope' })).toEqual({ body: { error: 'workspace not found' }, isError: true });
  });
});
