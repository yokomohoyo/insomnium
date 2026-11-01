import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../index';

describe('request versions', () => {
  beforeEach(globalBeforeEach);

  const send = async (requestId: string, url: string) => {
    await models.request.update((await models.request.getById(requestId))!, { url });
    return models.response.create({ parentId: requestId, statusCode: 200 }, 3);
  };

  it('keeps only the versions the kept responses refer to', async () => {
    const workspace = await models.workspace.create();
    const request = await models.request.create({ parentId: workspace._id, url: 'https://example.com/0' });

    for (let i = 1; i <= 10; i++) {
      await send(request._id, `https://example.com/${i}`);
    }

    const responses = await models.response.findByParentId(request._id);
    const versions = await models.requestVersion.findByParentId(request._id);
    // the last 3 and the new one, of 10
    expect(responses).toHaveLength(4);
    expect(versions.map(({ _id }) => _id).sort()).toEqual(responses.map(({ requestVersionId }) => requestVersionId).sort());
  });

  it('can still restore the request a kept response was sent with', async () => {
    const workspace = await models.workspace.create();
    const request = await models.request.create({ parentId: workspace._id, url: 'https://example.com/0' });
    const sent = [];
    for (let i = 1; i <= 5; i++) {
      sent.push(await send(request._id, `https://example.com/${i}`));
    }
    await models.request.update((await models.request.getById(request._id))!, { url: 'https://example.com/edited' });

    // the oldest response still kept
    await models.requestVersion.restore(sent[2].requestVersionId!);

    expect((await models.request.getById(request._id))!.url).toBe('https://example.com/3');
  });

  it("leaves another request's versions alone", async () => {
    const workspace = await models.workspace.create();
    const one = await models.request.create({ parentId: workspace._id });
    const other = await models.request.create({ parentId: workspace._id });
    await send(other._id, 'https://example.com/other');

    for (let i = 1; i <= 5; i++) {
      await send(one._id, `https://example.com/${i}`);
    }

    expect(await models.requestVersion.findByParentId(other._id)).toHaveLength(1);
  });

  it("keeps the versions of a WebSocket request's kept responses", async () => {
    const workspace = await models.workspace.create();
    const request = await models.webSocketRequest.create({ parentId: workspace._id, url: 'ws://example.com/0' });
    for (let i = 1; i <= 5; i++) {
      await models.webSocketRequest.update((await models.webSocketRequest.getById(request._id))!, { url: `ws://example.com/${i}` });
      await models.webSocketResponse.create({ parentId: request._id }, 2);
    }

    const responses = await models.webSocketResponse.findByParentId(request._id);
    const versions = await models.requestVersion.findByParentId(request._id);
    // the last 2 and the new one, of 5
    expect(responses).toHaveLength(3);
    expect(versions.map(({ _id }) => _id).sort()).toEqual(responses.map(({ requestVersionId }) => requestVersionId).sort());
  });
});
