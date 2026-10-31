import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generate, runTests, type Test } from 'insomnia-testing';
import { z } from 'zod';

import { database } from '../../../common/database';
import * as models from '../../../models';
import type { UnitTest } from '../../../models/unit-test';
import { getSendRequestCallback } from '../../../network/unit-test-feature';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// What the user is asked before a run: unit tests are JavaScript with the
// app's full access, and a client can write them (create_unit_test), so
// nothing runs until the user says so
export interface TestRunRequest {
  suite: string;
  workspace: string;
  tests: string[];
}
export type ConfirmTestRun = (run: TestRunRequest) => Promise<boolean>;

// the test runner keeps its helpers on the global object: one run at a time
let queue: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(task: () => Promise<T>) => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

// The app's only, with the app's dialog: the headless server has nobody to ask
export function registerTestRunTools(server: McpServer, confirm: ConfirmTestRun) {
  server.tool(
    'run_test_suite',
    "Run a test suite's unit tests, as the Test tab's Run does, and store the result there. Unit tests are JavaScript that runs with the app's full access, so the app asks the user to allow each run; a declined run returns an error and runs nothing. Returns each test's result and any error.",
    { testSuiteId: z.string() },
    async ({ testSuiteId }) => {
      const suite = await models.unitTestSuite.getById(testSuiteId);
      if (!suite) {
        return text({ error: 'test suite not found' }, true);
      }
      const workspace = await models.workspace.getById(suite.parentId);
      const unitTests = await database.find<UnitTest>(models.unitTest.type, { parentId: testSuiteId });
      if (!unitTests.length) {
        return text({ error: 'the test suite has no tests' }, true);
      }
      if (!await confirm({ suite: suite.name, workspace: workspace?.name || '', tests: unitTests.map(test => test.name) })) {
        return text({ error: 'the user declined to run the tests' }, true);
      }
      return oneAtATime(async () => {
        const tests: Test[] = unitTests.map(test => ({ name: test.name, code: test.code, defaultRequestId: test.requestId }));
        let results;
        try {
          results = await runTests(generate([{ name: suite.name, suites: [], tests }]), { sendRequest: getSendRequestCallback() });
        } catch (err) {
          // code that doesn't parse: nothing ran
          return text({ error: `the tests could not run: ${(err as Error).message}` }, true);
        }
        if (workspace) {
          await models.unitTestResult.create({ results, parentId: workspace._id });
        }
        const failures = new Map(results.failures.map(failure => [failure.fullTitle, failure]));
        const failed = results.stats.failures;
        return text({
          passed: failed === 0,
          stats: { tests: results.stats.tests, passes: results.stats.passes, failures: failed, durationMs: results.stats.duration },
          tests: results.tests.map(test => {
            const failure = failures.get(test.fullTitle);
            return {
              title: test.title,
              passed: !failure,
              ...(failure ? { error: 'message' in failure.err ? failure.err.message : 'failed' } : {}),
              durationMs: test.duration,
            };
          }),
        }, failed > 0);
      });
    },
  );
}
