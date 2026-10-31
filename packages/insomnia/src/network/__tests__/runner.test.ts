import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import type { RequestAssertion } from '../assertions';
import { runLoadTest } from '../load-test';
import * as networkUtils from '../network';
import { listRunnableRequests, runRequests } from '../runner';

window.app = electron.app;

// the mocked libcurl answers 200 with JSON describing what it was asked to send
const status200: RequestAssertion = { id: 'a1', source: 'status', operator: 'equals', value: '200' };

describe('runner', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    const workspace = await models.workspace.create({ name: 'Run' });
    workspaceId = workspace._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { host: 'http://localhost', id: 'base' } });
  });

  const request = (name: string, metaSortKey: number, fields: object = {}, parentId = workspaceId) =>
    models.request.create({ parentId, name, metaSortKey, url: '{{ host }}/{{ id }}', assertions: [status200], ...fields });

  it("lists a workspace's HTTP requests in the sidebar's order, folders and all", async () => {
    await request('third', 30);
    const folder = await models.requestGroup.create({ parentId: workspaceId, name: 'Users', metaSortKey: 20 });
    await request('in folder', 2, {}, folder._id);
    await request('first', 10);
    await models.webSocketRequest.create({ parentId: workspaceId, name: 'not HTTP', metaSortKey: 0 });

    const runnable = await listRunnableRequests(workspaceId);
    expect(runnable.map(({ request, folders }) => [...folders, request.name].join('/'))).toEqual(['first', 'Users/in folder', 'third']);
    expect((await listRunnableRequests(folder._id, ['Users'])).map(({ request }) => request.name)).toEqual(['in folder']);
  });

  it('sends each request once per iteration, with its data row over the environment', async () => {
    await request('one', 1);
    await request('two', 2, { assertions: [status200, { id: 'a2', source: 'body', operator: 'contains', value: '/second' }] });
    const onResult = jest.fn();

    const summary = await runRequests(await listRunnableRequests(workspaceId), { data: [{ id: 'first' }, { id: 'second' }], onResult });

    expect(summary.iterations).toBe(2);
    expect(summary.results.map(({ iteration, name, url, passed }) => ({ iteration, name, url, passed }))).toEqual([
      { iteration: 1, name: 'one', url: 'http://localhost/first', passed: true },
      { iteration: 1, name: 'two', url: 'http://localhost/first', passed: false },
      { iteration: 2, name: 'one', url: 'http://localhost/second', passed: true },
      { iteration: 2, name: 'two', url: 'http://localhost/second', passed: true },
    ]);
    expect(summary.requests).toEqual({ total: 4, failed: 1 });
    expect(summary.assertions).toEqual({ total: 6, failed: 1 });
    expect(summary.bailed).toBe(false);
    expect(onResult).toHaveBeenCalledTimes(4);
    // responses are stored, so the next request (and the app) can read them
    const [first] = summary.results;
    expect(await models.response.getById(first.responseId || '')).toMatchObject({ parentId: first.requestId, statusCode: 200 });
  });

  it('repeats the environment when there is no data, and the last rows cycle', async () => {
    await request('one', 1);
    const plain = await runRequests(await listRunnableRequests(workspaceId), { iterations: 2 });
    expect(plain.results.map(({ url }) => url)).toEqual(['http://localhost/base', 'http://localhost/base']);

    const cycled = await runRequests(await listRunnableRequests(workspaceId), { iterations: 3, data: [{ id: 'a' }, { id: 'b' }] });
    expect(cycled.results.map(({ url }) => url)).toEqual(['http://localhost/a', 'http://localhost/b', 'http://localhost/a']);
  });

  it("keeps each send's timings, size and HTTP version for the run's numbers", async () => {
    await request('one', 1);
    const [result] = (await runRequests(await listRunnableRequests(workspaceId))).results;
    // the mocked libcurl: resolved at 10 ms, connected at 30 ms, first byte at 500 ms, 800 bytes
    expect(result).toMatchObject({ timings: { dns: 10, connect: 30, tls: 0, firstByte: 500 }, bytes: 800, httpVersion: expect.any(String) });
  });

  it('records a request that fails to render, and stops there with bail', async () => {
    await request('broken', 1, { url: "{% nope 'x' %}" });
    await request('after', 2);

    const kept = await runRequests(await listRunnableRequests(workspaceId));
    expect(kept.results.map(({ name, passed }) => ({ name, passed }))).toEqual([{ name: 'broken', passed: false }, { name: 'after', passed: true }]);
    expect(kept.results[0].error).toMatch(/nope/);

    const bailed = await runRequests(await listRunnableRequests(workspaceId), { bail: true });
    expect(bailed.results.map(({ name }) => name)).toEqual(['broken']);
    expect(bailed.bailed).toBe(true);
  });

  it('stops before the next request when its signal aborts', async () => {
    await request('one', 1);
    await request('two', 2);
    const controller = new AbortController();
    const summary = await runRequests(await listRunnableRequests(workspaceId), { onResult: () => controller.abort(), signal: controller.signal });
    expect(summary.results.map(({ name }) => name)).toEqual(['one']);
    expect(summary.stopped).toBe(true);
  });

  it("doesn't send an event stream, which never ends, and runs on past it", async () => {
    await request('one', 1);
    await request('New Event Stream', 2, { headers: [{ name: 'Accept', value: 'text/event-stream' }] });
    await request('three', 3);

    const summary = await runRequests(await listRunnableRequests(workspaceId));
    expect(summary.results.map(({ name, passed, error }) => ({ name, passed, error }))).toEqual([
      { name: 'one', passed: true, error: undefined },
      { name: 'New Event Stream', passed: false, error: "not run: event streams aren't supported by the runner" },
      { name: 'three', passed: true, error: undefined },
    ]);
    await expect(runLoadTest(await listRunnableRequests(workspaceId), { virtualUsers: 1, durationMs: 1000 })).rejects.toThrow('New Event Stream is an event stream');
  });

  it('cancels the request in flight when its signal aborts', async () => {
    await request('hangs', 1);
    await request('after', 2);
    const send = jest.spyOn(networkUtils, 'sendCurlAndWriteTimeline').mockReturnValue(new Promise(() => {}));
    const cancel = jest.spyOn(networkUtils, 'cancelCurlAndWriteTimeline').mockResolvedValue();
    const controller = new AbortController();
    try {
      const running = runRequests(await listRunnableRequests(workspaceId), { signal: controller.signal });
      await new Promise(resolve => setTimeout(resolve, 200));
      controller.abort();

      const summary = await running;
      expect(summary.results).toEqual([]);
      expect(summary.stopped).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledWith(send.mock.calls[0][0]._id);
    } finally {
      send.mockRestore();
      cancel.mockRestore();
    }
  });
});
