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
  - { _id: env_base, _type: environment, parentId: wrk_1, name: Base Environment, data: { host: 'api.example.com', expected: '200' } }
  - { _id: env_staging, _type: environment, parentId: env_base, name: staging, data: {} }
  - _id: req_ok
    _type: request
    parentId: wrk_1
    name: allowed
    method: GET
    url: 'https://{{ host }}/{{ path }}'
    assertions:
      - { id: asrt_1, source: status, operator: equals, value: '{{ expected }}' }
      - { id: asrt_2, source: header, property: X-Nope, operator: exists }
  - { _id: req_no, _type: request, parentId: wrk_1, name: elsewhere, method: GET, url: 'https://example.org/' }
  - { _id: req_env, _type: request, parentId: wrk_1, name: from env, method: GET, url: "https://api.example.com/{% env 'INSOMNIUM_TEST_PATH' %}" }
  - { _id: req_home, _type: request, parentId: wrk_1, name: not allowed, method: GET, url: "https://api.example.com/{% env 'HOME' %}" }
`;

describe('insomnium-server', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    process.env.INSOMNIUM_TEST_PATH = 'from-env';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-server-'));
    fs.writeFileSync(path.join(dir, 'collection.yaml'), collection);
    ({ http: server } = await startServer({
      collections: [path.join(dir, 'collection.yaml')],
      repos: [],
      pullInterval: 0,
      environment: 'staging',
      host: '127.0.0.1',
      port: 0,
      token,
      allowedHosts: ['api.example.com'],
      variables: { path: 'v1' },
      validateSSL: true,
      allowedEnvironmentVariables: 'INSOMNIUM_TEST_*',
    }));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    setRequestPolicy(null);
    delete process.env.INSOMNIUM_TEST_PATH;
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
    expect(names).toEqual(expect.arrayContaining(['get_spec', 'list_response_examples', 'list_test_suites', 'list_flows', 'get_flow', 'run_flow', 'search', 'generate_code']));
    // generate_code only writes code out; generate_requests_from_spec adds requests
    expect(names.filter((name: string) => name !== 'generate_code' && /^(create|update|delete|duplicate|add|remove|import|clear|generate)_|^set_(spec|cookie)$/.test(name))).toEqual([]);
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
    // the expected value is rendered too
    expect(sent.data.assertions).toEqual({
      passed: 1,
      failed: 1,
      results: [
        { passed: true, message: 'Status code equals 200' },
        { passed: false, message: 'Header X-Nope exists: got nothing' },
      ],
    });
  });

  it('refuses a host that is not allowed', async () => {
    const refused = await call('send_http_request', { requestId: await requestId('elsewhere') });
    expect(refused).toMatchObject({ isError: true, data: { error: expect.stringMatching(/not in INSOMNIUM_ALLOWED_HOSTS/) } });
  });

  it('reads the environment variables INSOMNIUM_ALLOWED_ENV allows, and no others', async () => {
    const sent = await call('send_http_request', { requestId: await requestId('from env') });
    expect(sent).toMatchObject({ isError: false, data: { url: 'https://api.example.com/from-env' } });

    // a render error comes back as text
    const { result } = await (await rpc('tools/call', { name: 'send_http_request', arguments: { requestId: await requestId('not allowed') } })).json() as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/HOME isn't an allowed environment variable/);
  });
});
