import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerCollectionTools } from '../collections';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerCollectionTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  let body: any = result.content[0].text;
  try {
    body = JSON.parse(body);
  } catch {
    // text
  }
  return { body, isError: !!result.isError };
};

describe('the collection tools', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
  });

  it('create folders, in a workspace or a folder', async () => {
    const { body } = await call('create_request_group', { parentId: workspaceId, name: 'Orders' });
    expect(await models.requestGroup.getById(body.requestGroupId)).toEqual(expect.objectContaining({ name: 'Orders', parentId: workspaceId }));
    expect(await call('create_request_group', { parentId: 'nope', name: 'x' })).toEqual({ body: { error: 'parentId is not a workspace or folder' }, isError: true });
  });

  it("list cookies, without their values unless asked", async () => {
    const jar = await models.cookieJar.getOrCreateForParentId(workspaceId);
    await models.cookieJar.update(jar, { cookies: [{ id: '1', key: 'session', value: 'secret', domain: 'shop.example.com', path: '/', secure: true, httpOnly: true, expires: null } as any] });
    expect((await call('list_cookies', { workspaceId, showValues: false })).body).toEqual([expect.objectContaining({ name: 'session', domain: 'shop.example.com' })]);
    expect((await call('list_cookies', { workspaceId, showValues: false })).body[0].value).toBeUndefined();
    expect((await call('list_cookies', { workspaceId, showValues: true })).body[0].value).toBe('secret');
  });

  it("import what the app imports, and export as Insomnium's format, Postman's or OpenAPI", async () => {
    const imported = await call('import_collection', { workspaceId, content: "curl -X POST https://shop.example.com/orders -H 'X-Trace: 1' -d '{\"item\":\"book\"}'" });
    expect(imported.body).toMatchObject({ ok: true, format: 'cURL', imported: { requests: 1 } });
    const [request] = await models.request.findByParentId(workspaceId);
    expect(request).toMatchObject({ method: 'POST', url: 'https://shop.example.com/orders' });

    const insomnium = (await call('export_workspace', { workspaceId, format: 'insomnium', includePrivate: false })).body;
    expect(insomnium.resources.map(({ _type }: { _type: string }) => _type)).toEqual(expect.arrayContaining(['workspace', 'request']));
    const postman = (await call('export_workspace', { workspaceId, format: 'postman', includePrivate: false })).body;
    expect(postman.info).toMatchObject({ name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' });
    expect(postman.item[0].request).toMatchObject({ method: 'POST', url: { raw: 'https://shop.example.com/orders' } });
    const openapi = (await call('export_workspace', { workspaceId, format: 'openapi', includePrivate: false })).body;
    expect(openapi).toContain('openapi: 3.0.3');
    expect(openapi).toContain('  - url: https://shop.example.com');
    expect(openapi).toContain('  /orders:\n    post:');
  });

  it('run a folder, with each result and a summary', async () => {
    await models.request.create({ parentId: workspaceId, name: 'Health', url: 'http://localhost/health', assertions: [{ id: 'a', source: 'status', operator: 'equals', value: '200' }] });
    const run = await call('run_requests', { parentId: workspaceId, iterations: 1, bail: false });
    expect(run.isError).toBe(false);
    expect(run.body).toMatchObject({ passed: true, summary: { total: 1, failed: 0 }, results: [{ name: 'Health', statusCode: 200, passed: true, assertions: [{ passed: true, message: 'Status code equals 200' }] }] });
    expect(await call('run_requests', { parentId: 'empty', iterations: 1, bail: false })).toEqual({ body: { error: 'no HTTP requests under parentId' }, isError: true });
  });
});
