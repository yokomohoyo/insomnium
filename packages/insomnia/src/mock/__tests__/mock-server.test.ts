/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import http from 'node:http';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import type { ResponseExample } from '../../models/response-example';
import { chooseExample, MockLogEntry, mockPathOf, pathScore } from '../mock-routes';
import { MockServer, startMockServer } from '../mock-server';

describe('mock routes', () => {
  it.each([
    ['https://api.example.com/pets/:id?expand=1', '/pets/:id'],
    ['{{ base_url }}/pets/{{ id }}', '/pets/{{ id }}'],
    ["{% env 'BASE' %}/pets", '/pets'],
    ['api.example.com/pets', '/api.example.com/pets'],
    ['http://localhost:3000', '/'],
  ])('%s is for %s', (url, path) => {
    expect(mockPathOf(url)).toBe(path);
  });

  it('match paths segment by segment, more literal segments scoring higher', () => {
    expect(pathScore('/pets/:id', '/pets/7')).toBe(1);
    expect(pathScore('/pets/mine', '/pets/mine')).toBe(2);
    expect(pathScore('/pets/{{ id }}/toys', '/pets/7/toys')).toBe(2);
    expect(pathScore('/pets/:id', '/pets/7/toys')).toBeNull();
    expect(pathScore('/pets/mine', '/pets/7')).toBeNull();
  });

  it("choose the example a request asks for, or else the first success", () => {
    const examples = [
      { name: 'Missing', statusCode: 404 },
      { name: 'Found', statusCode: 200 },
      { name: 'Created', statusCode: 201 },
    ] as ResponseExample[];
    expect(chooseExample(examples, {})?.name).toBe('Found');
    expect(chooseExample(examples, { 'x-mock-response-code': '404' })?.name).toBe('Missing');
    expect(chooseExample(examples, { 'x-mock-response-name': 'Created' })?.name).toBe('Created');
    expect(chooseExample(examples, { 'x-mock-response-name': 'Nope' })).toBeUndefined();
  });
});

describe('startMockServer()', () => {
  let server: MockServer;
  let log: MockLogEntry[];

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    const workspace = await models.workspace.create({ name: 'Pets' });
    const base = await models.environment.getOrCreateForParentId(workspace._id);
    await models.environment.update(base, { data: { owner: 'Kim' } });
    const getPet = await models.request.create({ parentId: workspace._id, name: 'Get pet', method: 'GET', url: '{{ base_url }}/pets/:id' });
    const myPets = await models.request.create({ parentId: workspace._id, name: 'My pets', method: 'GET', url: '{{ base_url }}/pets/mine' });
    await models.request.create({ parentId: workspace._id, name: 'No examples', method: 'POST', url: '{{ base_url }}/pets' });
    await models.responseExample.create({ parentId: getPet._id, name: 'Found', statusCode: 200, statusMessage: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Content-Length', value: '999' }], body: '{"id": 7, "owner": "{{ owner }}"}', metaSortKey: 1 });
    await models.responseExample.create({ parentId: getPet._id, name: 'Missing', statusCode: 404, statusMessage: 'Not Found', body: '{"error": "no pet"}', metaSortKey: 2 });
    await models.responseExample.create({ parentId: myPets._id, name: 'Mine', statusCode: 200, body: '[]' });
    log = [];
    server = await startMockServer({ workspaceIds: [workspace._id], onRequest: entry => log.push(entry) });
  });

  afterEach(async () => {
    await server.close();
  });

  it("answers with the matching request's example, rendering its tags", async () => {
    const response = await fetch(`${server.url}/pets/7`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('content-length')).not.toBe('999');
    expect(await response.json()).toEqual({ id: 7, owner: 'Kim' });
    expect(log).toEqual([expect.objectContaining({ method: 'GET', path: '/pets/7', status: 200, requestName: 'Get pet', exampleName: 'Found' })]);
  });

  it('answers with the example a request asks for, the most literal path first', async () => {
    const missing = await fetch(`${server.url}/pets/7`, { headers: { 'x-mock-response-code': '404' } });
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'no pet' }]);
    expect(await (await fetch(`${server.url}/pets/mine`)).json()).toEqual([]);
  });

  it('says why when nothing answers', async () => {
    const none = await fetch(`${server.url}/owners/1`);
    expect([none.status, await none.json()]).toEqual([404, { error: 'Insomnium mock: no request with an example matches', method: 'GET', path: '/owners/1' }]);
    // a request without examples doesn't answer
    expect((await fetch(`${server.url}/pets`, { method: 'POST' })).status).toBe(404);
  });

  it('lets pages on this computer read it, and no other site', async () => {
    const local = await fetch(`${server.url}/pets/7`, { headers: { Origin: 'http://localhost:3000' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const preflight = await fetch(`${server.url}/pets/7`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173' } });
    expect([preflight.status, preflight.headers.get('access-control-allow-methods')]).toEqual([204, 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS']);
    const elsewhere = await fetch(`${server.url}/pets/7`, { headers: { Origin: 'https://evil.example.com' } });
    expect(elsewhere.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a request for another host, as a DNS-rebinding page would send', async () => {
    const status = await new Promise(resolve => {
      http.get(`${server.url}/pets/7`, { headers: { Host: 'evil.example.com' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
    });
    expect(status).toBe(403);
    expect(log.at(-1)).toEqual(expect.objectContaining({ status: 403, note: 'refused the host evil.example.com' }));
  });
});
