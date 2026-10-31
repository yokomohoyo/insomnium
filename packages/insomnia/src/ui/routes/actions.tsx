import type { IRuleResult } from '@stoplight/spectral-core';
import { generate, runTests, type Test } from 'insomnia-testing';
import { ActionFunction, redirect } from 'react-router-dom';

import { ACTIVITY_DEBUG, ACTIVITY_SPEC } from '../../common/constants';
import { database } from '../../common/database';
import { database as db } from '../../common/database';
import { ResourceCache, scanResources } from '../../common/import';
import { specSyncSummary, syncSpecToWorkspace } from '../../common/spec-sync';
import { spectralRulesetFor } from '../../common/spectral-ruleset-path';
import * as models from '../../models';
import { getById, update } from '../../models/helpers/request-operations';
import { DEFAULT_ORGANIZATION_ID } from '../../models/organization';
import { DEFAULT_PROJECT_ID } from '../../models/project';
import { isRequestGroup, isRequestGroupId } from '../../models/request-group';
import { UnitTest } from '../../models/unit-test';
import { Workspace } from '../../models/workspace';
import { WorkspaceMeta } from '../../models/workspace-meta';
import { getSendRequestCallback } from '../../network/unit-test-feature';
import { guard } from '../../utils/guard';

// Project
export const createNewProjectAction: ActionFunction = async ({ request, params }) => {
  const { organizationId } = params;
  guard(organizationId, 'Organization ID is required');
  const formData = await request.formData();
  const name = formData.get('name');
  guard(typeof name === 'string', 'Name is required');
  const project = await models.project.create({ name });

  return redirect(`/organization/${organizationId}/project/${project._id}`);
};

export const renameProjectAction: ActionFunction = async ({
  request,
  params,
}) => {
  const formData = await request.formData();

  const name = formData.get('name');
  guard(typeof name === 'string', 'Name is required');

  const { projectId } = params;
  guard(projectId, 'Project ID is required');

  const project = await models.project.getById(projectId);

  guard(project, 'Project not found');

  await models.project.update(project, { name });

  return null;
};

export const deleteProjectAction: ActionFunction = async ({ params }) => {
  const { organizationId, projectId } = params;
  guard(organizationId, 'Organization ID is required');
  guard(projectId, 'Project ID is required');
  const project = await models.project.getById(projectId);
  guard(project, 'Project not found');

  await models.stats.incrementDeletedRequestsForDescendents(project);
  await models.project.remove(project);

  return redirect(`/organization/${DEFAULT_ORGANIZATION_ID}/project/${DEFAULT_PROJECT_ID}`);
};

// Workspace
export const createNewWorkspaceAction: ActionFunction = async ({
  params,
  request,
}) => {
  const { organizationId, projectId } = params;
  guard(organizationId, 'Organization ID is required');
  guard(projectId, 'Project ID is required');

  const project = await models.project.getById(projectId);

  guard(project, 'Project not found');

  const formData = await request.formData();

  const name = formData.get('name');
  guard(typeof name === 'string', 'Name is required');

  const scope = formData.get('scope');
  guard(scope === 'design' || scope === 'collection', 'Scope is required');

  const flushId = await database.bufferChanges();

  const workspace = await models.workspace.create({
    name,
    scope,
    parentId: projectId,
  });

  console.log({ workspace, name });

  if (scope === 'design') {
    await models.apiSpec.getOrCreateForParentId(workspace._id);
  }

  // Create default env, cookie jar, and meta
  await models.environment.getOrCreateForParentId(workspace._id);
  await models.cookieJar.getOrCreateForParentId(workspace._id);
  await models.workspaceMeta.getOrCreateByParentId(workspace._id);

  await database.flushChanges(flushId);

  return redirect(
    `/organization/${organizationId}/project/${projectId}/workspace/${workspace._id}/${workspace.scope === 'collection' ? ACTIVITY_DEBUG : ACTIVITY_SPEC
    }`
  );
};

export const deleteWorkspaceAction: ActionFunction = async ({
  params,
  request,
}) => {
  const { organizationId, projectId } = params;
  guard(projectId, 'projectId is required');

  const project = await models.project.getById(projectId);
  guard(project, 'Project not found');

  const formData = await request.formData();

  const workspaceId = formData.get('workspaceId');
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  await models.stats.incrementDeletedRequestsForDescendents(workspace);
  await models.workspace.remove(workspace);

  return redirect(`/organization/${organizationId}/project/${projectId}`);
};

export const duplicateWorkspaceAction: ActionFunction = async ({ request, params }) => {
  const { organizationId } = params;
  guard(organizationId, 'Organization Id is required');
  const formData = await request.formData();
  const projectId = formData.get('projectId');
  guard(typeof projectId === 'string', 'Project ID is required');

  const workspaceId = formData.get('workspaceId');
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const name = formData.get('name') || '';
  guard(typeof name === 'string', 'Name is required');

  const duplicateToProject = await models.project.getById(projectId);
  guard(duplicateToProject, 'Project not found');
  async function duplicate(
    workspace: Workspace,
    { name, parentId }: Pick<Workspace, 'name' | 'parentId'>,
  ) {
    const newWorkspace = await db.duplicate(workspace, {
      name,
      parentId,
    });
    await models.apiSpec.updateOrCreateForParentId(newWorkspace._id, {
      fileName: name,
    });
    models.stats.incrementCreatedRequestsForDescendents(newWorkspace);
    return newWorkspace;
  }
  const newWorkspace = await duplicate(workspace, {
    name,
    parentId: projectId,
  });

  // Create default env, cookie jar, and meta
  await models.environment.getOrCreateForParentId(newWorkspace._id);
  await models.cookieJar.getOrCreateForParentId(newWorkspace._id);
  await models.workspaceMeta.getOrCreateByParentId(newWorkspace._id);

  return redirect(
    `/organization/${organizationId}/project/${projectId}/workspace/${newWorkspace._id}/${newWorkspace.scope === 'collection' ? ACTIVITY_DEBUG : ACTIVITY_SPEC
    }`
  );
};

export const updateWorkspaceAction: ActionFunction = async ({ request }) => {
  const patch = await request.json();
  const workspaceId = patch.workspaceId;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  // a design document made without its spec (by MCP before 0.7.2) gets one
  if (workspace.scope === 'design') {
    await models.apiSpec.updateOrCreateForParentId(workspaceId, {
      fileName: patch.name || workspace.name,
    });
  }

  await models.workspace.update(workspace, patch);

  return null;
};

// a collection becomes a design document, with a spec, or a document a
// collection; its spec is kept, for if it becomes a document again. The menu
// goes to the right tab after: a redirect from here is dropped when the change
// revalidates the routes first (root.tsx)
export const convertWorkspaceAction: ActionFunction = async ({ request, params }) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  const { scope } = await request.json();
  guard(scope === 'design' || scope === 'collection', 'Scope is required');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  if (scope === 'design') {
    const apiSpec = await models.apiSpec.getOrCreateForParentId(workspaceId);
    if (!apiSpec.fileName) {
      await models.apiSpec.update(apiSpec, { fileName: workspace.name });
    }
  }
  await models.workspace.update(workspace, { scope });

  return { scope };
};

export const updateWorkspaceMetaAction: ActionFunction = async ({ request, params }) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  const patch = await request.json() as Partial<WorkspaceMeta>;
  await models.workspaceMeta.updateByParentId(workspaceId, patch);
  return null;
};

// Test Suite
export const createNewTestSuiteAction: ActionFunction = async ({
  request,
  params,
}) => {
  const { organizationId, workspaceId, projectId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  const formData = await request.formData();
  const name = formData.get('name');
  guard(typeof name === 'string', 'Name is required');

  const unitTestSuite = await models.unitTestSuite.create({
    parentId: workspaceId,
    name,
  });

  return redirect(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/test/test-suite/${unitTestSuite._id}`);
};

export const deleteTestSuiteAction: ActionFunction = async ({ params }) => {
  const { organizationId, workspaceId, projectId, testSuiteId } = params;
  guard(typeof testSuiteId === 'string', 'Test Suite ID is required');
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  guard(typeof projectId === 'string', 'Project ID is required');

  const unitTestSuite = await models.unitTestSuite.getById(testSuiteId);

  guard(unitTestSuite, 'Test Suite not found');

  await models.unitTestSuite.remove(unitTestSuite);

  return redirect(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/test`);
};

const notRun = (unitTests: UnitTest[], err: Error) => {
  const failures = unitTests.map(test => ({
    title: test.name,
    fullTitle: test.name,
    currentRetry: 0,
    err: { message: err.message, stack: err.stack || '' },
  }));
  const now = new Date();
  return {
    failures,
    passes: [],
    pending: [],
    tests: failures,
    stats: { suites: 1, tests: failures.length, passes: 0, pending: 0, failures: failures.length, start: now, end: now, duration: 0 },
  };
};

export const runAllTestsAction: ActionFunction = async ({
  params,
}) => {
  const { organizationId, projectId, workspaceId, testSuiteId } = params;
  guard(typeof projectId === 'string', 'Project ID is required');
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  guard(typeof testSuiteId === 'string', 'Test Suite ID is required');

  const unitTests = await database.find<UnitTest>(models.unitTest.type, {
    parentId: testSuiteId,
  });
  guard(unitTests, 'No unit tests found');
  // no tests, nothing run: not a green "Tests Passed 0/0"
  if (!unitTests.length) {
    return null;
  }

  const tests: Test[] = unitTests
    .filter(t => t !== null)
    .map(t => ({
      name: t.name,
      code: t.code,
      defaultRequestId: t.requestId,
    }));

  const src = generate([{ name: 'My Suite', suites: [], tests }]);

  const sendRequest = getSendRequestCallback();

  // code that doesn't parse throws before any test runs: each fails with it
  const results = await runTests(src, { sendRequest }).catch((err: Error) => notRun(unitTests, err));

  const testResult = await models.unitTestResult.create({
    results,
    parentId: workspaceId,
  });

  return redirect(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/test/test-suite/${testSuiteId}/test-result/${testResult._id}`);
};

export const renameTestSuiteAction: ActionFunction = async ({ request, params }) => {
  const { workspaceId, projectId, testSuiteId } = params;
  guard(typeof testSuiteId === 'string', 'Test Suite ID is required');
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  guard(typeof projectId === 'string', 'Project ID is required');

  const formData = await request.formData();
  const name = formData.get('name');
  guard(typeof name === 'string', 'Name is required');

  const unitTestSuite = await database.getWhere(models.unitTestSuite.type, {
    _id: testSuiteId,
  });

  guard(unitTestSuite, 'Test Suite not found');

  await models.unitTestSuite.update(unitTestSuite, { name });

  return null;
};

// Unit Test
export const createNewTestAction: ActionFunction = async ({ request, params }) => {
  const { testSuiteId } = params;
  guard(typeof testSuiteId === 'string', 'Test Suite ID is required');
  const formData = await request.formData();

  const name = formData.get('name');
  guard(typeof name === 'string', 'Name is required');

  await models.unitTest.create({
    parentId: testSuiteId,
    code: `const response1 = await insomnia.send();
expect(response1.status).to.equal(200);`,
    name,
  });

  return null;
};

export const deleteTestAction: ActionFunction = async ({ params }) => {
  const { testId } = params;
  guard(typeof testId === 'string', 'Test ID is required');

  const unitTest = await database.getWhere<UnitTest>(models.unitTest.type, {
    _id: testId,
  });

  guard(unitTest, 'Test not found');

  await models.unitTest.remove(unitTest);

  return null;
};

export const updateTestAction: ActionFunction = async ({ request, params }) => {
  const { testId } = params;
  const formData = await request.formData();
  guard(typeof testId === 'string', 'Test ID is required');
  const code = formData.get('code');
  guard(typeof code === 'string', 'Code is required');
  const name = formData.get('name');
  guard(typeof name === 'string', 'Name is required');
  const requestId = formData.get('requestId');

  if (requestId) {
    guard(typeof requestId === 'string', 'Request ID is required');
  }

  const unitTest = await database.getWhere<UnitTest>(models.unitTest.type, {
    _id: testId,
  });
  guard(unitTest, 'Test not found');

  await models.unitTest.update(unitTest, { name, code, requestId: requestId || null });

  return null;
};

export const runTestAction: ActionFunction = async ({ params }) => {
  const { organizationId, projectId, workspaceId, testSuiteId, testId } = params;
  guard(typeof testId === 'string', 'Test ID is required');

  const unitTest = await database.getWhere<UnitTest>(models.unitTest.type, {
    _id: testId,
  });
  guard(unitTest, 'Test not found');

  const tests: Test[] = [
    {
      name: unitTest.name,
      code: unitTest.code,
      defaultRequestId: unitTest.requestId,
    },
  ];
  const src = generate([{ name: 'My Suite', suites: [], tests }]);

  const sendRequest = getSendRequestCallback();

  const results = await runTests(src, { sendRequest }).catch((err: Error) => notRun([unitTest], err));

  const testResult = await models.unitTestResult.create({
    results,
    parentId: unitTest.parentId,
  });

  return redirect(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/test/test-suite/${testSuiteId}/test-result/${testResult._id}`);
};

// Api Spec
export const updateApiSpecAction: ActionFunction = async ({
  request,
  params,
}) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  const formData = await request.formData();
  const contents = formData.get('contents');
  const fromSync = Boolean(formData.get('fromSync'));

  guard(typeof contents === 'string', 'Contents is required');

  const apiSpec = await models.apiSpec.getByParentId(workspaceId);

  guard(apiSpec, 'API Spec not found');
  await database.update({
    ...apiSpec,
    modified: Date.now(),
    created: fromSync ? Date.now() : apiSpec.created,
    contents,
  }, fromSync);

  return null;
};

export const generateCollectionFromApiSpecAction: ActionFunction = async ({
  params,
}) => {
  const { projectId, workspaceId } = params;

  guard(typeof projectId === 'string', 'Project ID is required');
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const apiSpec = await models.apiSpec.getByParentId(workspaceId);

  if (!apiSpec) {
    throw new Error('No API Specification was found');
  }

  const workspace = await models.workspace.getById(workspaceId);

  guard(workspace, 'Workspace not found');

  const isLintError = (result: IRuleResult) => result.severity === 0;
  const { rulesetPath } = await spectralRulesetFor(workspaceId);

  const results = (await window.main.spectralRun({ contents: apiSpec.contents, rulesetPath })).filter(isLintError);
  if (apiSpec.contents && results && results.length) {
    throw new Error('Error Generating Configuration');
  }

  const scanned = await scanResources({
    content: apiSpec.contents,
  });
  if (scanned.errors.length || !ResourceCache) {
    throw new Error(scanned.errors[0] || 'No requests found in the spec');
  }

  // updates the requests generated before instead of adding copies. The Spec
  // tab goes to the requests: a redirect from here is dropped when the
  // changes revalidate the routes before the action returns
  return { summary: specSyncSummary(await syncSpecToWorkspace({ workspaceId, resources: ResourceCache.resources })) };
};

export const createEnvironmentAction: ActionFunction = async ({
  params,
  request,
}) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const { isPrivate } = await request.json();

  const baseEnvironment = await models.environment.getByParentId(workspaceId);

  guard(baseEnvironment, 'Base environment not found');

  const environment = await models.environment.create({
    parentId: baseEnvironment._id,
    isPrivate,
  });
  // Manage Environments shows the active one: the new one, to fill in
  await models.workspaceMeta.update(await models.workspaceMeta.getOrCreateByParentId(workspaceId), { activeEnvironmentId: environment._id });

  return environment;
};
export const updateEnvironment: ActionFunction = async ({ request, params }) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const { environmentId, patch } = await request.json();

  guard(typeof environmentId === 'string', 'Environment ID is required');

  const environment = await models.environment.getById(environmentId);

  guard(environment, 'Environment not found');
  guard(typeof name === 'string', 'Name is required');

  const baseEnvironment = await models.environment.getByParentId(workspaceId);

  guard(baseEnvironment, 'Base environment not found');

  const updatedEnvironment = await models.environment.update(environment, patch);

  return updatedEnvironment;
};

export const deleteEnvironmentAction: ActionFunction = async ({
  request, params,
}) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const formData = await request.formData();

  const environmentId = formData.get('environmentId');
  guard(typeof environmentId === 'string', 'Environment ID is required');

  const environment = await models.environment.getById(environmentId);

  const baseEnvironment = await models.environment.getByParentId(workspaceId);

  guard(environment?._id !== baseEnvironment?._id, 'Cannot delete base environment');

  guard(environment, 'Environment not found');

  await models.environment.remove(environment);

  return null;
};

export const duplicateEnvironmentAction: ActionFunction = async ({
  request, params,
}) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const formData = await request.formData();

  const environmentId = formData.get('environmentId');

  guard(typeof environmentId === 'string', 'Environment ID is required');

  const environment = await models.environment.getById(environmentId);
  guard(environment, 'Environment not found');

  const newEnvironment = await models.environment.duplicate(environment);
  // shown, as a new one is
  await models.workspaceMeta.update(await models.workspaceMeta.getOrCreateByParentId(workspaceId), { activeEnvironmentId: newEnvironment._id });

  return newEnvironment;
};

export const setActiveEnvironmentAction: ActionFunction = async ({
  request, params,
}) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const formData = await request.formData();

  const environmentId = formData.get('environmentId');

  guard(typeof environmentId === 'string', 'Environment ID is required');

  const workspaceMeta = await models.workspaceMeta.getOrCreateByParentId(workspaceId);

  guard(workspaceMeta, 'Workspace meta not found');

  await models.workspaceMeta.update(workspaceMeta, { activeEnvironmentId: environmentId || null });

  return null;
};

export const updateCookieJarAction: ActionFunction = async ({
  request, params,
}) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');

  const { cookieJarId, patch } = await request.json();

  guard(typeof cookieJarId === 'string', 'Cookie Jar ID is required');

  const cookieJar = await models.cookieJar.getById(cookieJarId);

  guard(cookieJar, 'Cookie Jar not found');

  const updatedCookieJar = await models.cookieJar.update(cookieJar, patch);

  return updatedCookieJar;
};

export const createNewCaCertificateAction: ActionFunction = async ({ request }) => {
  const patch = await request.json();
  await models.caCertificate.create(patch);
  return null;
};

export const updateCaCertificateAction: ActionFunction = async ({ request }) => {
  const patch = await request.json();
  const caCertificate = await models.caCertificate.getById(patch._id);
  guard(caCertificate, 'CA Certificate not found');
  await models.caCertificate.update(caCertificate, patch);
  return null;
};

export const deleteCaCertificateAction: ActionFunction = async ({ params }) => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  const caCertificate = await models.caCertificate.findByParentId(workspaceId);
  guard(caCertificate, 'CA Certificate not found');
  await models.caCertificate.removeWhere(workspaceId);
  return null;
};

export const createNewClientCertificateAction: ActionFunction = async ({ request }) => {
  const patch = await request.json();
  await models.clientCertificate.create(patch);
  return null;
};

export const updateClientCertificateAction: ActionFunction = async ({ request }) => {
  const patch = await request.json();
  const clientCertificate = await models.clientCertificate.getById(patch._id);
  guard(clientCertificate, 'CA Certificate not found');
  await models.clientCertificate.update(clientCertificate, patch);
  return null;
};

export const deleteClientCertificateAction: ActionFunction = async ({ request }) => {
  const { _id } = await request.json();
  const clientCertificate = await models.clientCertificate.getById(_id);
  guard(clientCertificate, 'CA Certificate not found');
  await models.clientCertificate.remove(clientCertificate);
  return null;
};

export const updateSettingsAction: ActionFunction = async ({ request }) => {
  const patch = await request.json();
  await models.settings.patch(patch);
  return null;
};

const getCollectionItem = async (id: string) => {
  let item;
  if (isRequestGroupId(id)) {
    item = await models.requestGroup.getById(id);
  } else {
    item = await getById(id);
  }

  guard(item, 'Item not found');

  return item;
};

export const reorderCollectionAction: ActionFunction = async ({ request, params }) => {
  const { workspaceId }  = params;
  guard(typeof workspaceId === 'string', 'Workspace ID is required');
  const { id, targetId, dropPosition, metaSortKey } = await request.json();
  guard(typeof id === 'string', 'ID is required');
  guard(typeof targetId === 'string', 'Target ID is required');
  guard(typeof dropPosition === 'string', 'Drop position is required');
  guard(typeof metaSortKey === 'number', 'MetaSortKey position is required');

  if (id === targetId) {
    return null;
  }

  const item = await getCollectionItem(id);
  const targetItem = await getCollectionItem(targetId);

  const parentId = dropPosition === 'after' && isRequestGroup(targetItem) ? targetItem._id : targetItem.parentId;

  if (isRequestGroup(item)) {
    await models.requestGroup.update(item, { parentId, metaSortKey });
  } else {
    await update(item, { parentId, metaSortKey });
  }

  return null;
};
