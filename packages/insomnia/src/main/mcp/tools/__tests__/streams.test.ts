import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { type EventStreamControls, registerStreamTools, type StreamEvent } from '../streams';

window.app = electron.app;

// the app's connections (main/network/curl.ts), without a network: opening
// one records what it was asked, and its response holds the events
const opened: Parameters<EventStreamControls['open']>[0][] = [];
const open = new Set<string>();
const events = new Map<string, StreamEvent[]>();
const controls: EventStreamControls = {
  open: async options => {
    opened.push(options);
    open.add(options.requestId);
    const response = await models.response.create({ parentId: options.requestId });
    await models.requestMeta.updateOrCreateByParentId(options.requestId, { activeResponseId: response._id });
    events.set(response._id, [
      { type: 'message', timestamp: 2000, data: '{"n":2}' },
      { type: 'message', timestamp: 1000, data: '{"n":1}' },
      { type: 'open', timestamp: 500 },
    ]);
  },
  close: requestId => open.delete(requestId),
  isOpen: async requestId => open.has(requestId),
  events: async responseId => events.get(responseId) || [],
};

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerStreamTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, controls, { waitMs: 200 });

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the event stream tools', () => {
  let workspaceId: string;
  let streamId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    opened.length = 0;
    open.clear();
    workspaceId = (await models.workspace.create({ name: 'Live' }))._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { base: 'http://localhost:4010', token: 's3cret' } });
    streamId = (await models.request.create({
      parentId: workspaceId,
      name: 'Feed',
      url: '{{ base }}/events',
      headers: [{ name: 'Accept', value: 'text/event-stream' }, { name: 'Authorization', value: 'Bearer {{ token }}' }],
    }))._id;
  });

  it('connect renders the request in the environment, and read shows what arrived, newest first', async () => {
    expect(await call('connect_event_stream', { requestId: streamId })).toEqual({ body: { ok: true, open: true }, isError: false });
    expect(opened[0]).toMatchObject({ requestId: streamId, workspaceId, url: 'http://localhost:4010/events', headers: expect.arrayContaining([{ name: 'Authorization', value: 'Bearer s3cret' }]) });

    const read = (await call('read_event_stream', { requestId: streamId, limit: 2 })).body;
    expect(read).toMatchObject({ open: true, total: 3, events: [{ type: 'message', data: '{"n":2}' }, { type: 'message', data: '{"n":1}' }] });

    expect((await call('connect_event_stream', { requestId: streamId })).body).toMatchObject({ open: true, note: 'it was already connected' });
    expect(opened).toHaveLength(1);
    expect((await call('close_event_stream', { requestId: streamId })).body).toEqual({ ok: true, wasOpen: true });
    expect((await call('read_event_stream', { requestId: streamId, limit: 50 })).body.open).toBe(false);
  });

  it('refuses a request that is not an event stream, and a URL the policy blocks', async () => {
    const plain = (await models.request.create({ parentId: workspaceId, name: 'Plain', url: 'http://localhost:4010/pets/1' }))._id;
    expect(await call('connect_event_stream', { requestId: plain })).toEqual({ body: { error: 'event stream request not found' }, isError: true });
    const metadata = (await models.request.create({ parentId: workspaceId, name: 'Metadata', url: 'http://169.254.169.254/latest', headers: [{ name: 'Accept', value: 'text/event-stream' }] }))._id;
    const blocked = await call('connect_event_stream', { requestId: metadata });
    expect(blocked.isError).toBe(true);
    expect(opened).toEqual([]);
  });
});
