import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { registerTools } from '../index';
import { type ConfirmTestRun, registerTestRunTools } from '../test-run';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const confirm = jest.fn<ConfirmTestRun>();
const handlers: Record<string, Handler> = {};
registerTestRunTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, confirm);

const call = async (args: Record<string, unknown>) => {
  const result = await handlers.run_test_suite(args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('run_test_suite', () => {
  let workspaceId: string;
  let suiteId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    confirm.mockReset();
    workspaceId = (await models.workspace.create({ name: 'Shop', scope: 'design' }))._id;
    const requestId = (await models.request.create({ parentId: workspaceId, name: 'Health', url: 'http://localhost/health' }))._id;
    suiteId = (await models.unitTestSuite.create({ parentId: workspaceId, name: 'Smoke' }))._id;
    // the mocked libcurl answers 200
    await models.unitTest.create({ parentId: suiteId, name: 'is up', requestId, code: 'const response = await insomnia.send();\nexpect(response.status).to.equal(200);' });
    await models.unitTest.create({ parentId: suiteId, name: 'is teapot', requestId, code: 'const response = await insomnia.send();\nexpect(response.status).to.equal(418);' });
  });

  it('asks the user first, and runs nothing when they decline', async () => {
    confirm.mockResolvedValue(false);
    expect(await call({ testSuiteId: suiteId })).toEqual({ body: { error: 'the user declined to run the tests' }, isError: true });
    expect(confirm).toHaveBeenCalledWith({ suite: 'Smoke', workspace: 'Shop', tests: ['is up', 'is teapot'] });
    expect(await models.unitTestResult.all()).toEqual([]);
    expect(await models.response.all()).toEqual([]);
  });

  it('runs the tests once allowed, reports each, and stores the result for the Test tab', async () => {
    confirm.mockResolvedValue(true);
    const { body, isError } = await call({ testSuiteId: suiteId });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ passed: false, stats: { tests: 2, passes: 1, failures: 1 } });
    expect(body.tests).toEqual([
      expect.objectContaining({ title: 'is up', passed: true }),
      expect.objectContaining({ title: 'is teapot', passed: false, error: 'expected 200 to equal 418' }),
    ]);
    expect(await models.unitTestResult.all()).toEqual([expect.objectContaining({ parentId: workspaceId })]);
  });

  it('refuses a suite that is missing or empty, without asking', async () => {
    confirm.mockResolvedValue(true);
    expect(await call({ testSuiteId: 'uts_nope' })).toEqual({ body: { error: 'test suite not found' }, isError: true });
    const empty = await models.unitTestSuite.create({ parentId: workspaceId, name: 'Empty' });
    expect(await call({ testSuiteId: empty._id })).toEqual({ body: { error: 'the test suite has no tests' }, isError: true });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("is the app's only: the shared tools, which the headless server offers, don't have it", () => {
    const names = new Set<string>();
    registerTools({ tool: (name: string) => names.add(name) } as any);
    expect(names.has('run_test_suite')).toBe(false);
  });
});
