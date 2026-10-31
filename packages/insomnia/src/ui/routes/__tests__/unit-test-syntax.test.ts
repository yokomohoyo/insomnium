import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ActionFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { runAllTestsAction, runTestAction } from '../actions';

// jsdom has no Response for redirect() to make
jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  redirect: (url: string) => ({ redirectedTo: url }),
}));

describe('a unit test whose code does not parse', () => {
  let params: Record<string, string>;

  beforeEach(async () => {
    await globalBeforeEach();
    const workspaceId = (await models.workspace.create({ name: 'Pets' }))._id;
    const testSuiteId = (await models.unitTestSuite.create({ parentId: workspaceId, name: 'Suite' }))._id;
    const testId = (await models.unitTest.create({ parentId: testSuiteId, name: 'Returns 200', code: 'expect((((' }))._id;
    params = { organizationId: 'org', projectId: 'proj', workspaceId, testSuiteId, testId };
  });

  const run = (action: typeof runAllTestsAction) => action({ request: {}, params } as unknown as ActionFunctionArgs);

  it.each([['Run Tests', runAllTestsAction], ['one test', runTestAction]])('fails in the results from %s, not the window', async (_, action) => {
    expect(await run(action)).toMatchObject({ redirectedTo: expect.stringContaining('/test-result/') });
    const [{ results }] = await models.unitTestResult.all();
    expect(results.stats).toMatchObject({ tests: 1, passes: 0, failures: 1 });
    expect(results.tests[0].title).toBe('Returns 200');
    expect(results.tests[0].err.message).toBeTruthy();
  });
});
