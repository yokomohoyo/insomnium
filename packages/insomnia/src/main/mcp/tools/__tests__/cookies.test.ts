import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerCookieTools } from '../cookies';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerCookieTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

// the zod defaults, which the handler capture skips
const cookie = (fields: Record<string, unknown>) => ({ path: '/', secure: false, httpOnly: false, ...fields });

describe('the cookie tools', () => {
  let workspaceId: string;
  const jar = async () => (await models.cookieJar.getOrCreateForParentId(workspaceId)).cookies;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
  });

  it('add a cookie, then change it', async () => {
    const added = (await call('set_cookie', cookie({ workspaceId, domain: 'shop.example.com', name: 'session', value: 'abc' }))).body;
    expect(added).toMatchObject({ ok: true, updated: false, expires: '2038-01-19T03:14:07.000Z' });
    const [first] = await jar();
    expect(first).toMatchObject({ key: 'session', value: 'abc', domain: 'shop.example.com', path: '/', id: expect.any(String) });

    const changed = (await call('set_cookie', cookie({ workspaceId, domain: 'shop.example.com', name: 'session', value: 'def', expires: '2030-01-01T00:00:00Z', httpOnly: true }))).body;
    expect(changed).toMatchObject({ ok: true, updated: true, expires: '2030-01-01T00:00:00.000Z' });
    expect(await jar()).toEqual([expect.objectContaining({ id: first.id, value: 'def', httpOnly: true })]);

    expect(await call('set_cookie', cookie({ workspaceId, domain: 'x', name: 'y', value: 'z', expires: 'whenever' }))).toEqual({ body: { error: 'expires is not a date' }, isError: true });
  });

  it('delete one cookie, or clear them', async () => {
    await call('set_cookie', cookie({ workspaceId, domain: 'shop.example.com', name: 'session', value: '1' }));
    await call('set_cookie', cookie({ workspaceId, domain: 'shop.example.com', name: 'session', value: '2', path: '/admin' }));
    await call('set_cookie', cookie({ workspaceId, domain: 'cdn.example.com', name: 'edge', value: '3' }));

    // two share the name: the path says which
    expect(await call('delete_cookie', { workspaceId, domain: 'shop.example.com', name: 'session' })).toEqual({ body: { error: '2 cookies match: give path, one of /, /admin' }, isError: true });
    expect((await call('delete_cookie', { workspaceId, domain: 'shop.example.com', name: 'session', path: '/admin' })).body).toEqual({ ok: true, domain: 'shop.example.com', path: '/admin', name: 'session' });
    expect(await call('delete_cookie', { workspaceId, domain: 'shop.example.com', name: 'nope' })).toEqual({ body: { error: 'cookie not found' }, isError: true });

    expect((await call('clear_cookies', { workspaceId, domain: 'cdn.example.com' })).body).toEqual({ ok: true, deleted: 1 });
    expect((await jar()).map(({ key }) => key)).toEqual(['session']);
    expect((await call('clear_cookies', { workspaceId })).body).toEqual({ ok: true, deleted: 1 });
    expect(await jar()).toEqual([]);

    expect(await call('clear_cookies', { workspaceId: 'wrk_nope' })).toEqual({ body: { error: 'workspace not found' }, isError: true });
  });
});
