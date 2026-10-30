import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerExampleTools } from '../examples';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerExampleTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the response example tools', () => {
  let requestId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    const workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    requestId = (await models.request.create({ parentId: workspaceId, name: 'Order', url: 'https://shop.example.com/orders/1' }))._id;
  });

  it('add, list, change and delete the examples of a request', async () => {
    const created = await call('create_response_example', {
      requestId, name: 'Not found', statusCode: 404, statusMessage: 'Not Found',
      headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"error":"no order"}',
    });
    expect(created.body).toMatchObject({ ok: true, name: 'Not found' });
    expect((await call('list_response_examples', { requestId })).body).toEqual([{
      id: created.body.id, name: 'Not found', statusCode: 404, statusMessage: 'Not Found',
      headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"error":"no order"}',
    }]);

    expect((await call('update_response_example', { exampleId: created.body.id, statusCode: 410, statusMessage: 'Gone' })).body).toEqual({ ok: true, id: created.body.id });
    // what's left out stays as it was
    expect(await models.responseExample.getById(created.body.id)).toMatchObject({ name: 'Not found', statusCode: 410, statusMessage: 'Gone', body: '{"error":"no order"}' });

    expect((await call('delete_response_example', { exampleId: created.body.id })).body).toEqual({ ok: true, id: created.body.id });
    expect((await call('list_response_examples', { requestId })).body).toEqual([]);
  });

  it("refuse what isn't there", async () => {
    expect(await call('create_response_example', { requestId: 'req_nope', name: 'x', statusCode: 200, statusMessage: 'OK', headers: [], body: '' })).toEqual({ body: { error: 'requestId is not an HTTP request' }, isError: true });
    expect(await call('update_response_example', { exampleId: 'ex_nope', name: 'x' })).toEqual({ body: { error: 'response example not found' }, isError: true });
    expect(await call('delete_response_example', { exampleId: 'ex_nope' })).toEqual({ body: { error: 'response example not found' }, isError: true });
  });
});
