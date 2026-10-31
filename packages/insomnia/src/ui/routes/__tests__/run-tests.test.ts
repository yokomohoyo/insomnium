import { beforeEach, describe, expect, it } from '@jest/globals';
import { ActionFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { runAllTestsAction } from '../actions';

describe('Run Tests', () => {
  let workspaceId: string;
  let testSuiteId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Pets' }))._id;
    testSuiteId = (await models.unitTestSuite.create({ parentId: workspaceId, name: 'Empty' }))._id;
  });

  it('runs nothing for a suite with no tests, and shows no result', async () => {
    const result = await runAllTestsAction({
      request: {},
      params: { organizationId: 'org', projectId: 'proj', workspaceId, testSuiteId },
    } as unknown as ActionFunctionArgs);
    expect(result).toBeNull();
    expect(await models.unitTestResult.all()).toEqual([]);
  });
});
