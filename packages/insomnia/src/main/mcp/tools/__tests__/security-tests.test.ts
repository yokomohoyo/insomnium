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
    expect(confirm).toHaveBeenCalledWith({ request: 'Orders', method: 'GET', url: 'http://localhost/orders', workspace: 'Shop', requests: 26 }, signal);
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
      ['lower-privilege', 'skipped'],
      ['cors-any-origin', 'passed'],
      ['answers-plain-http', 'skipped'],
      ['quote-in-parameter', 'skipped'],
      ['rate-limit', 'found'],
    ]);
    expect(body.findings).toEqual([expect.objectContaining({ id: 'rate-limit', severity: 'low' })]);
    expect(body.requests).toBe(17);
    // and nothing it sent is in the history
    expect(await models.response.all()).toEqual([]);
    expect(body.ignoredRules).toBeUndefined();
  });

  it('leaves out what the collection ignores in the Security tab, and says so', async () => {
    confirm.mockResolvedValue(true);
    await models.workspaceMeta.getOrCreateByParentId(workspaceId);
    await models.workspaceMeta.updateByParentId(workspaceId, { securityIgnoredRules: ['rate-limit'] });

    const { body } = await call({ requestId });

    expect(body.findings).toEqual([]);
    expect(body.ignoredRules).toEqual(['rate-limit']);
    // (the test still ran, and is still listed)
    expect(body.checks).toContainEqual(expect.objectContaining({ id: 'rate-limit', outcome: 'found' }));
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
    expect(names).not.toContain('run_security_checks');
  });
});

describe('run_security_checks', () => {
  let workspaceId: string;
  let folderId: string;
  const callChecks = async (args: Record<string, unknown>) => {
    const result = await handlers.run_security_checks(args, { signal });
    return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
  };

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    confirm.mockReset();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    folderId = (await models.requestGroup.create({ parentId: workspaceId, name: 'Orders' }))._id;
    await models.request.create({ parentId: folderId, name: 'List', url: 'http://localhost/orders', metaSortKey: 1 });
    await models.request.create({ parentId: folderId, name: 'Create', method: 'POST', url: 'http://localhost/orders', metaSortKey: 2 });
  });

  it('asks first, saying how many requests it may send, and sends nothing on a no', async () => {
    confirm.mockResolvedValue(false);

    expect(await callChecks({ parentId: folderId })).toEqual({ body: { error: 'the user declined to run the security checks' }, isError: true });
    expect(confirm).toHaveBeenCalledWith({ request: 'Orders', count: 2, workspace: 'Shop', requests: 26 }, signal);
    expect(await models.response.all()).toEqual([]);
  });

  it('checks each request once allowed: the GET tested, the POST never sent', async () => {
    confirm.mockResolvedValue(true);

    const { body, isError } = await callChecks({ parentId: workspaceId });

    expect(isError).toBe(false);
    // (the collection itself: no workspace to name beside it)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ request: 'Shop', workspace: '' }), signal);
    expect(body.items.map(({ name, outcome }: { name: string; outcome: string }) => [name, outcome])).toEqual([['List', 'tested'], ['Create', 'skipped']]);
    expect(body.items[0].findings.map(({ id }: { id: string }) => id)).toContain('rate-limit');
    expect(body.requests).toBe(17);
    expect(await models.response.all()).toEqual([]);
  });

  it('leaves out the rules the collection ignores, and names them', async () => {
    confirm.mockResolvedValue(true);
    await models.workspaceMeta.getOrCreateByParentId(workspaceId);
    await models.workspaceMeta.updateByParentId(workspaceId, { securityIgnoredRules: ['rate-limit'] });

    const { body } = await callChecks({ parentId: folderId });

    expect(body.items[0].findings.map(({ id }: { id: string }) => id)).not.toContain('rate-limit');
    expect(body.ignoredRules).toEqual(['rate-limit']);
  });

  it('refuses a parent that is not there, or has no requests, without asking', async () => {
    const empty = await models.requestGroup.create({ parentId: workspaceId, name: 'Empty' });

    expect((await callChecks({ parentId: 'fld_missing' })).isError).toBe(true);
    expect((await callChecks({ parentId: empty._id })).body).toEqual({ error: 'no HTTP requests under parentId' });
    expect(confirm).not.toHaveBeenCalled();
  });
});
