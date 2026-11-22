import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import type { FuzzPoint } from '../../../../common/fuzz';
import * as models from '../../../../models';
import type { FuzzAttemptResult, FuzzRunSummary, listFuzzPoints, runFuzz } from '../../../../network/fuzz-run';
import { type ConfirmFuzz, registerFuzzTools } from '../fuzz';

window.app = electron.app;

const signal = new AbortController().signal;
type Handler = (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const confirm = jest.fn<ConfirmFuzz>();
const list = jest.fn<typeof listFuzzPoints>();
const run = jest.fn<typeof runFuzz>();
const handlers: Record<string, Handler> = {};
registerFuzzTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, confirm, { list, run });

const call = async (tool: string, args: Record<string, unknown>) => {
  const result = await handlers[tool](args, { signal });
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

const POINTS: FuzzPoint[] = [
  { id: 'query:u0', kind: 'query', label: 'Query: status', original: 'open', suggested: true },
  { id: 'path:1', kind: 'path', label: 'Path: 1st part (orders)', original: 'orders', suggested: false },
  { id: 'header:0', kind: 'header', label: 'Header: X-Trace', original: 'a', suggested: false },
];
const attempt = (index: number, patch: Partial<FuzzAttemptResult> = {}): FuzzAttemptResult =>
  ({ index, pointId: 'query:u0', position: 'Query: status', payload: "'", statusCode: 200, bytes: 105, elapsed: 3.4, flags: [], notable: false, snippet: '{"orders":[]}', ...patch });
const summary = (attempts: FuzzAttemptResult[]): FuzzRunSummary =>
  ({ baseline: { statusCode: 200, bytes: 105, elapsed: 3 }, attempts, notable: attempts.filter(({ notable }) => notable).length, requests: attempts.length + 1, stopped: false });

describe('the fuzz tools', () => {
  let workspaceId: string;
  let requestId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    [confirm, list, run].forEach(mock => mock.mockReset());
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    requestId = (await models.request.create({ parentId: workspaceId, name: 'Orders', url: 'http://localhost/orders?status=open' }))._id;
    list.mockResolvedValue({ points: POINTS, method: 'GET', url: 'http://localhost/orders?status=open' });
  });

  describe('list_fuzz_points', () => {
    it('lists the positions and the payload lists, and sends nothing', async () => {
      const { body } = await call('list_fuzz_points', { requestId });

      expect(body).toMatchObject({ requestId, method: 'GET', url: 'http://localhost/orders?status=open' });
      expect(body.positions[0]).toEqual({ id: 'query:u0', label: 'Query: status', value: 'open', suggested: true });
      expect(body.lists.map(({ id }: { id: string }) => id)).toEqual(['sql', 'nosql', 'traversal', 'script', 'commands', 'ids', 'types', 'fields']);
      expect(body.lists[0].payloads).toBeGreaterThan(5);
      expect(confirm).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });

    it("has nothing for what isn't an HTTP request, or an environment from another collection", async () => {
      expect((await call('list_fuzz_points', { requestId: 'req_none' })).isError).toBe(true);
      const elsewhere = await models.environment.create({ parentId: (await models.workspace.create({ name: 'Other' }))._id, name: 'theirs' });
      expect((await call('list_fuzz_points', { requestId, environmentId: elsewhere._id })).isError).toBe(true);
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('fuzz_request', () => {
    it('asks the user first, saying what it sends, and sends nothing when they decline', async () => {
      confirm.mockResolvedValue(false);

      expect(await call('fuzz_request', { requestId, lists: ['commands'] })).toEqual({ body: { error: 'the user declined to fuzz the request' }, isError: true });
      // the suggested position, each of the list's 6 payloads, and the request as it is
      expect(confirm).toHaveBeenCalledWith({ request: 'Orders', method: 'GET', url: 'http://localhost/orders?status=open', workspace: 'Shop', requests: 7, positions: ['Query: status'], lists: ['Commands'], changesData: false }, signal);
      expect(run).not.toHaveBeenCalled();
    });

    it('takes only a plain yes for one', async () => {
      confirm.mockResolvedValue('yes' as unknown as boolean);

      expect((await call('fuzz_request', { requestId, lists: ['sql'] })).isError).toBe(true);
      expect(run).not.toHaveBeenCalled();
    });

    it('says when the request changes data', async () => {
      confirm.mockResolvedValue(false);
      const post = await models.request.create({ parentId: workspaceId, name: 'Create', method: 'POST', url: 'http://localhost/orders' });
      list.mockResolvedValue({ points: [{ id: 'json-new', kind: 'json-new', label: 'Body: a new field', original: '', suggested: true }], method: 'POST', url: 'http://localhost/orders' });

      await call('fuzz_request', { requestId: post._id, payloads: ['role=owner', 'isAdmin=true'] });

      expect(confirm.mock.calls[0][0]).toMatchObject({ method: 'POST', requests: 3, positions: ['Body: a new field'], lists: ['2 of your own'], changesData: true });
    });

    it('fuzzes once allowed: the attempts that stood out in full, the rest in brief', async () => {
      confirm.mockResolvedValue(true);
      run.mockResolvedValue(summary([
        attempt(1),
        attempt(2, { payload: "' OR '1'='1", statusCode: 500, notable: true, flags: [{ id: 'server-error', label: 'The server failed', notable: true }], snippet: 'You have an error in your SQL syntax'.padEnd(900, '.') }),
      ]));

      const { body, isError } = await call('fuzz_request', { requestId, positions: ['Query: status', 'header:0'], lists: ['sql'], delayMs: 20 });

      expect(isError).toBe(false);
      expect(run).toHaveBeenCalledWith(requestId, expect.objectContaining({ pointIds: ['query:u0', 'header:0'], delay: 20, signal, checkUrl: expect.any(Function) }));
      expect(run.mock.calls[0][1].payloads.length).toBeGreaterThan(5);
      expect(body).toMatchObject({ requestId, baseline: { statusCode: 200 }, requests: 3, attempts: 2, stopped: false });
      expect(body.worthALook).toHaveLength(1);
      expect(body.worthALook[0]).toMatchObject({ attempt: 2, position: 'Query: status', payload: "' OR '1'='1", statusCode: 500, flags: ['The server failed'] });
      expect(body.worthALook[0].answer).toHaveLength(600);
      expect(body.others).toEqual([{ attempt: 1, position: 'Query: status', payload: "'", statusCode: 200, bytes: 105, ms: 3, flags: [] }]);
    });

    it("leaves out most of a long run's quiet attempts, and says how many", async () => {
      confirm.mockResolvedValue(true);
      run.mockResolvedValue(summary(Array.from({ length: 130 }, (_, index) => attempt(index + 1))));

      const { body } = await call('fuzz_request', { requestId, positions: ['all'], lists: ['sql'] });

      expect(body.others).toHaveLength(100);
      expect(body.othersLeftOut).toBe(30);
    });

    it('counts and runs the attempts the way asked for', async () => {
      confirm.mockResolvedValue(true);
      run.mockResolvedValue(summary([attempt(1)]));

      await call('fuzz_request', { requestId, positions: ['all'], lists: ['commands'], mode: 'together' });
      // 6 payloads, each in all three positions at once, and the request as it is
      expect(confirm.mock.calls[0][0].requests).toBe(7);
      expect(run.mock.calls[0][1].mode).toBe('together');

      await call('fuzz_request', { requestId, positions: ['all'], lists: ['commands'], mode: 'combinations' });
      expect(confirm.mock.calls[1][0].requests).toBe(6 ** 3 + 1);
    });

    it('refuses before asking when there is nothing to try', async () => {
      expect((await call('fuzz_request', { requestId })).body.error).toContain('nothing to try: name payload lists (sql, nosql,');
      expect((await call('fuzz_request', { requestId, lists: ['made-up'] })).body.error).toContain('no payload list named made-up');
      expect((await call('fuzz_request', { requestId, positions: ['Query: page'], lists: ['sql'] })).body.error).toContain("no position 'Query: page' in the request. It has: Query: status,");
      // fields to slip in have nowhere to go without a JSON body
      expect((await call('fuzz_request', { requestId, lists: ['fields'] })).body.error).toContain('none of the payloads chosen fit the positions chosen');
      expect(confirm).not.toHaveBeenCalled();
    });

    it('says why when the run fails', async () => {
      confirm.mockResolvedValue(true);
      run.mockRejectedValue(new Error('Refusing to send to 169.254.169.254'));

      expect((await call('fuzz_request', { requestId, lists: ['sql'] })).body.error).toBe('the request could not be fuzzed: Refusing to send to 169.254.169.254');
    });
  });
});
