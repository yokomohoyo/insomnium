import { describe, expect, it } from '@jest/globals';

import {
  debugPath,
  designPath,
  gitPath,
  newProjectPath,
  organizationPath,
  projectPath,
  requestGroupPath,
  requestPath,
  testPath,
  testResultPath,
  testSuitePath,
  unitTestPath,
  workspaceHomePath,
  workspacePath,
} from '../paths';

const project = { organizationId: 'org_1', projectId: 'proj_1' };
const ids = { ...project, workspaceId: 'wrk_1' };
const workspace = '/organization/org_1/project/proj_1/workspace/wrk_1';

describe('route paths', () => {
  it('builds organization and project paths', () => {
    expect(organizationPath('org_1')).toBe('/organization/org_1');
    expect(newProjectPath('org_1')).toBe('/organization/org_1/project/new');
    expect(projectPath(project)).toBe('/organization/org_1/project/proj_1');
    expect(projectPath(project, 'delete')).toBe('/organization/org_1/project/proj_1/delete');
    expect(projectPath(project, 'git/clone')).toBe('/organization/org_1/project/proj_1/git/clone');
    expect(projectPath(project, 'workspace/new')).toBe('/organization/org_1/project/proj_1/workspace/new');
  });

  it('builds workspace paths', () => {
    expect(workspacePath(ids)).toBe(workspace);
    expect(workspacePath(ids, 'update-meta')).toBe(`${workspace}/update-meta`);
    expect(workspacePath(ids, 'environment/set-active')).toBe(`${workspace}/environment/set-active`);
    expect(workspacePath(ids, 'flows')).toBe(`${workspace}/flows`);
    // an empty rest keeps the slash the template had
    expect(workspacePath(ids, '')).toBe(`${workspace}/`);
  });

  it('opens a document on its spec and anything else on its requests', () => {
    expect(workspaceHomePath(ids, { scope: 'design' })).toBe(`${workspace}/spec`);
    expect(workspaceHomePath(ids, { scope: 'collection' })).toBe(`${workspace}/debug`);
    expect(workspaceHomePath(ids, { scope: 'other' })).toBe(`${workspace}/debug`);
  });

  it('builds debug, request and folder paths', () => {
    expect(debugPath(ids)).toBe(`${workspace}/debug`);
    expect(`${debugPath(ids)}/reorder`).toBe(`${workspace}/debug/reorder`);
    expect(debugPath(ids, 'request/new')).toBe(`${workspace}/debug/request/new`);
    expect(debugPath(ids, 'request-group/duplicate')).toBe(`${workspace}/debug/request-group/duplicate`);
    expect(requestPath(ids, 'req_1')).toBe(`${workspace}/debug/request/req_1`);
    expect(requestPath(ids, 'req_1', 'send')).toBe(`${workspace}/debug/request/req_1/send`);
    expect(requestPath(ids, 'req_1', 'response/delete-all')).toBe(`${workspace}/debug/request/req_1/response/delete-all`);
    expect(requestGroupPath(ids, 'fld_1', 'update-meta')).toBe(`${workspace}/debug/request-group/fld_1/update-meta`);
  });

  it('builds design paths', () => {
    expect(designPath(ids, 'update')).toBe(`${workspace}/spec/update`);
    expect(designPath(ids, 'generate-request-collection')).toBe(`${workspace}/spec/generate-request-collection`);
  });

  it('builds test paths', () => {
    expect(testPath(ids)).toBe(`${workspace}/test`);
    expect(testPath(ids, 'test-suite/new')).toBe(`${workspace}/test/test-suite/new`);
    expect(testSuitePath(ids, 'uts_1')).toBe(`${workspace}/test/test-suite/uts_1`);
    expect(testSuitePath(ids, 'uts_1', 'run-all-tests')).toBe(`${workspace}/test/test-suite/uts_1/run-all-tests`);
    expect(testSuitePath(ids, 'uts_1', 'test/new')).toBe(`${workspace}/test/test-suite/uts_1/test/new`);
    expect(unitTestPath(ids, 'uts_1', 'ut_1', 'run')).toBe(`${workspace}/test/test-suite/uts_1/test/ut_1/run`);
    expect(testResultPath(ids, 'uts_1', 'utr_1')).toBe(`${workspace}/test/test-suite/uts_1/test-result/utr_1`);
  });

  it('builds git paths', () => {
    expect(gitPath(ids, 'repo')).toBe(`${workspace}/git/repo`);
    expect(gitPath(ids, 'branch/checkout')).toBe(`${workspace}/git/branch/checkout`);
  });

  it('writes a missing id out, as the templates did', () => {
    expect(organizationPath(undefined)).toBe('/organization/undefined');
    expect(projectPath({ organizationId: undefined, projectId: undefined })).toBe('/organization/undefined/project/undefined');
    expect(requestPath({ organizationId: 'org_1', projectId: undefined, workspaceId: undefined }, undefined, 'update'))
      .toBe('/organization/org_1/project/undefined/workspace/undefined/debug/request/undefined/update');
    expect(requestPath(ids, null)).toBe(`${workspace}/debug/request/null`);
  });
});
