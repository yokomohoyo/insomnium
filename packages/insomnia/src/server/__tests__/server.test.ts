/**
 * @jest-environment node
 */
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { setRequestPolicy } from '../../network/request-policy';
import { startServer } from '../server';

jest.mock('electron');

const token = 'test-token-'.padEnd(40, 'x');
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Test API, scope: collection }
  - { _id: env_base, _type: environment, parentId: wrk_1, name: Base Environment, data: { host: 'api.example.com' } }
  - { _id: env_staging, _type: environment, parentId: env_base, name: staging, data: {} }
  - { _id: req_ok, _type: request, parentId: wrk_1, name: allowed, method: GET, url: 'https://{{ host }}/{{ path }}' }
  - { _id: req_no, _type: request, parentId: wrk_1, name: elsewhere, method: GET, url: 'https://example.org/' }
`;

describe('insomnium-server', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-server-'));
    fs.writeFileSync(path.join(dir, 'collection.yaml'), collection);
    ({ http: server } = await startServer({
      collections: [path.join(dir, 'collection.yaml')],
      environment: 'staging',
      host: '127.0.0.1',
      port: 0,
      token,
      allowedHosts: ['api.example.com'],
      variables: { path: 'v1' },
      validateSSL: true,
    }));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    setRequestPolicy(null);
    server.close();
  });

  let id = 0;
  const rpc = (method: string, params: object, authorization = `Bearer ${token}`) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const call = async (name: string, args: object) => {
    const { result } = await (await rpc('tools/call', { name, arguments: args })).json() as any;
    return { isError: !!result.isError, data: JSON.parse(result.content[0].text) };
  };
  const requestId = async (name: string) => {
    const [workspace] = (await call('list_workspaces', {})).data;
    return (await call('list_requests', { workspaceId: workspace.id })).data.find((request: any) => request.name === name).id;
  };

  it('answers /health without a token, and nothing else', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await rpc('tools/list', {}, 'Bearer nope')).status).toBe(401);
    expect((await rpc('tools/list', {}, '')).status).toBe(401);
  });

  it('offers the tools that read and send, and none that edit', async () => {
    const { result } = await (await rpc('tools/list', {})).json() as any;
    const names = result.tools.map((tool: any) => tool.name).sort();
    expect(names).toContain('send_http_request');
    expect(names).toContain('get_last_response');
    expect(names.filter((name: string) => /^(create|update|delete|add|remove|import)_/.test(name))).toEqual([]);
  });

  it('loads the collection with the chosen environment and the variables', async () => {
    const { data } = await call('get_request', { requestId: await requestId('allowed') });
    expect(data.name).toBe('allowed');
    const environments = (await call('list_environments', { workspaceId: (await call('list_workspaces', {})).data[0].id })).data;
    expect(JSON.stringify(environments)).toContain('staging');
  });

  it('sends to an allowed host, rendered', async () => {
    const sent = await call('send_http_request', { requestId: await requestId('allowed') });
    expect(sent.isError).toBe(false);
    expect(sent.data.url).toBe('https://api.example.com/v1');
  });

  it('refuses a host that is not allowed', async () => {
    const refused = await call('send_http_request', { requestId: await requestId('elsewhere') });
    expect(refused).toMatchObject({ isError: true, data: { error: expect.stringMatching(/not in INSOMNIUM_ALLOWED_HOSTS/) } });
  });
});
