import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerTools } from '../index';
import { type ConfirmSecurityTests, registerSecurityTestTools } from '../security-tests';

window.app = electron.app;

// the MCP request's, as the SDK passes it
const signal = new AbortController().signal;
type Handler = (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const confirm = jest.fn<ConfirmSecurityTests>();
const handlers: Record<string, Handler> = {};
registerSecurityTestTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, confirm);

const call = async (args: Record<string, unknown>) => {
  const result = await handlers.run_security_tests(args, { signal });
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('run_security_tests', () => {
  let workspaceId: string;
  let requestId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    confirm.mockReset();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    requestId = (await models.request.create({ parentId: workspaceId, name: 'Orders', url: 'http://localhost/orders' }))._id;
  });

  it('asks the user first, and sends nothing when they decline', async () => {
    confirm.mockResolvedValue(false);

    expect(await call({ requestId })).toEqual({ body: { error: 'the user declined to run the security tests' }, isError: true });
    expect(confirm).toHaveBeenCalledWith({ request: 'Orders', method: 'GET', url: 'http://localhost/orders', workspace: 'Shop', requests: 25 }, signal);
  });

  it('takes only a plain yes for one', async () => {
    confirm.mockResolvedValue('yes' as unknown as boolean);

    expect((await call({ requestId })).isError).toBe(true);
  });

  it('runs the tests once allowed, and reports each with what was found', async () => {
    confirm.mockResolvedValue(true);

    const { body, isError } = await call({ requestId });

    expect(isError).toBe(false);
    expect(body.requestId).toBe(requestId);
    // the mocked libcurl answers 200 to everything, with what it was sent
    expect(body.checks.map(({ id, outcome }: { id: string; outcome: string }) => [id, outcome])).toEqual([
      ['baseline', 'passed'],
      ['no-credentials', 'skipped'],
      ['token-signature', 'skipped'],
      ['token-unsigned', 'skipped'],
      ['other-user', 'skipped'],
      ['cors-any-origin', 'passed'],
      ['plain-http', 'skipped'],
      ['quote-in-parameter', 'skipped'],
      ['rate-limit', 'found'],
    ]);
    expect(body.findings).toEqual([expect.objectContaining({ id: 'rate-limit', severity: 'low' })]);
    expect(body.requests).toBe(17);
    // and nothing it sent is in the history
    expect(await models.response.all()).toEqual([]);
  });

  it('refuses a request that changes things, a missing one, and an environment from another workspace, without asking', async () => {
    const post = await models.request.create({ parentId: workspaceId, method: 'POST', url: 'http://localhost/orders' });
    expect((await call({ requestId: post._id })).body.error).toContain('only a GET or HEAD request is tested');
    expect((await call({ requestId: 'req_missing' })).isError).toBe(true);
    const elsewhere = await models.workspace.create({ name: 'Other' });
    const foreign = await models.environment.create({ parentId: elsewhere._id, name: 'Theirs' });
    expect((await call({ requestId, otherEnvironmentId: foreign._id })).isError).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('is not one of the tools every server has: only the app can ask', () => {
    const names: string[] = [];
    registerTools({ tool: (name: string) => names.push(name) } as any);

    expect(names).not.toContain('run_security_tests');
  });
});
