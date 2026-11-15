import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { trustTestCode } from '../../test-code-trust';
import { runAllTestsAction, runTestAction } from '../actions';
import { indexLoader } from '../test-results';

// jsdom has no Response for redirect() to make
jest.mock('react-router-dom', () => ({
  ...(jest.requireActual('react-router-dom') as typeof import('react-router-dom')),
  redirect: (url: string) => ({ redirectedTo: url }),
}));

describe('the results a test suite opens with', () => {
  let workspaceId: string;
  let ranSuiteId: string;
  let testId: string;
  let otherSuiteId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Pets' }))._id;
    ranSuiteId = (await models.unitTestSuite.create({ parentId: workspaceId, name: 'Ran' }))._id;
    otherSuiteId = (await models.unitTestSuite.create({ parentId: workspaceId, name: 'Never ran' }))._id;
    // code that does not parse fails without sending anything
    testId = (await models.unitTest.create({ parentId: ranSuiteId, name: 'Returns 200', code: 'expect((((' }))._id;
    trustTestCode(['expect((((']);
  });

  const params = (testSuiteId: string) => ({ organizationId: 'org', projectId: 'proj', workspaceId, testSuiteId });
  const open = (testSuiteId: string) => indexLoader({ request: {}, params: params(testSuiteId) } as unknown as LoaderFunctionArgs);

  it.each([
    ['Run Tests', () => runAllTestsAction({ request: {}, params: params(ranSuiteId) } as unknown as ActionFunctionArgs)],
    ['one test', () => runTestAction({ request: {}, params: { ...params(ranSuiteId), testId } } as unknown as ActionFunctionArgs)],
  ])('are its own last run from %s, and none for a suite that never ran', async (_, run) => {
    await run();
    const [result] = await models.unitTestResult.all();

    expect(await open(ranSuiteId)).toEqual({ redirectedTo: expect.stringContaining(`/test-suite/${ranSuiteId}/test-result/${result._id}`) });
    expect(await open(otherSuiteId)).toBeNull();
  });

  it('go with the suite when it is deleted', async () => {
    await runAllTestsAction({ request: {}, params: params(ranSuiteId) } as unknown as ActionFunctionArgs);
    expect(await models.unitTestResult.all()).toHaveLength(1);

    const suite = await models.unitTestSuite.getById(ranSuiteId);
    await models.unitTestSuite.remove(suite!);

    expect(await models.unitTestResult.all()).toEqual([]);
  });
});
