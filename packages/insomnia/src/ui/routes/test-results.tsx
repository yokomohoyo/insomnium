import React, { type FC } from 'react';
import { type LoaderFunction, redirect, useRouteLoaderData } from 'react-router-dom';

import { database } from '../../common/database';
import * as models from '../../models';
import type { UnitTestResult } from '../../models/unit-test-result';
import { guard } from '../../utils/guard';
import { ListGroup, UnitTestResultItem } from '../components/list-group';
import { testResultPath } from './paths';

interface TestResultsData {
  testResult: UnitTestResult;
}

export const indexLoader: LoaderFunction = async ({ params }) => {
  const { organizationId, projectId, workspaceId, testSuiteId } = params;
  guard(projectId, 'Project ID is required');
  guard(organizationId, 'Organization ID is required');
  guard(workspaceId, 'Workspace ID is required');
  guard(testSuiteId, 'Test suite ID is required');

  // this suite's own last run, not the last run of any suite in the workspace
  const testResult = await models.unitTestResult.getLatestByParentId(testSuiteId);
  if (testResult) {
    return redirect(testResultPath({ organizationId, projectId, workspaceId }, testSuiteId, testResult._id));
  }

  return null;
};

export const loader: LoaderFunction = async ({
  params,
}): Promise<TestResultsData> => {
  const { testResultId } = params;
  guard(testResultId, 'Test Result ID is required');
  const testResult = await database.getWhere<UnitTestResult>(models.unitTestResult.type, {
    _id: testResultId,
  });
  guard(testResult, 'Test Result not found');
  return {
    testResult,
  };
};

export const TestRunStatus: FC = () => {
  const { testResult } = useRouteLoaderData(':testResultId') as TestResultsData;

  const { stats, tests } = testResult.results;
  return (
    <div className="unit-tests__results">
      {testResult && (
        <div key={testResult._id}>
          <div className="unit-tests__top-header">
            {stats.failures ? (
              <h2 className="warning">
                Tests Failed {stats.failures}/{stats.tests}
              </h2>
            ) : (
              <h2 className="success">
                Tests Passed {stats.passes}/{stats.tests}
              </h2>
            )}
          </div>
          <ListGroup>
            {tests.map((t: any, i: number) => (
              // eslint-disable-next-line react/no-array-index-key -- results of a finished run: no id, and the list never changes
              <UnitTestResultItem key={i} item={t} />
            ))}
          </ListGroup>
        </div>
      )}
    </div>
  );
};
