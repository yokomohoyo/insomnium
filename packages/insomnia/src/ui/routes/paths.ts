import { ACTIVITY_DEBUG, ACTIVITY_SPEC } from '../../common/constants';

// the app's paths, as the route tree in ../router.tsx spells them.
// an id is written out as it comes: route params can be undefined
type Id = string | undefined;

interface ProjectIds {
  organizationId: Id;
  projectId: Id;
}

interface WorkspaceIds extends ProjectIds {
  workspaceId: Id;
}

type ProjectOp = 'delete' | 'rename' | 'git/clone' | 'workspace/new' | 'workspace/update' | 'workspace/delete';
type DebugOp = 'request/new' | 'request/delete' | 'request-group/new' | 'request-group/delete' | 'request-group/duplicate';
type RequestOp = 'send' | 'connect' | 'duplicate' | 'update' | 'update-meta' | 'response/delete-all' | 'response/delete';
type RequestGroupOp = 'update' | 'update-meta';
type DesignOp = 'update' | 'generate-request-collection';
type TestSuiteOp = 'delete' | 'rename' | 'run-all-tests' | 'test/new';
type UnitTestOp = 'delete' | 'update' | 'run';
type GitBranchOp = 'new' | 'delete' | 'checkout' | 'merge' | 'rebase';
type GitOp =
  | 'status' | 'changes' | 'commit' | 'branches' | 'log' | 'fetch' | 'tags' | 'stashes'
  | 'rollback' | 'repo' | 'update' | 'reset' | 'pull' | 'push'
  | `branch/${GitBranchOp}`;

const withOp = (path: string, op?: string) => (op === undefined ? path : `${path}/${op}`);

export const organizationPath = (organizationId: Id) => `/organization/${organizationId}`;

export const newProjectPath = (organizationId: Id) => `${organizationPath(organizationId)}/project/new`;

export const projectPath = ({ organizationId, projectId }: ProjectIds, op?: ProjectOp) =>
  withOp(`${organizationPath(organizationId)}/project/${projectId}`, op);

// rest is whatever follows the workspace: a view, or one of its actions
export const workspacePath = ({ organizationId, projectId, workspaceId }: WorkspaceIds, rest?: string) =>
  withOp(`${projectPath({ organizationId, projectId })}/workspace/${workspaceId}`, rest);

// where a workspace opens: a document on its spec, anything else on its requests
export const workspaceHomePath = (ids: WorkspaceIds, { scope }: { scope: string }) =>
  workspacePath(ids, scope === 'design' ? ACTIVITY_SPEC : ACTIVITY_DEBUG);

export const debugPath = (ids: WorkspaceIds, op?: DebugOp) =>
  withOp(workspacePath(ids, ACTIVITY_DEBUG), op);

export const requestPath = (ids: WorkspaceIds, requestId: Id | null, op?: RequestOp) =>
  withOp(`${debugPath(ids)}/request/${requestId}`, op);

export const requestGroupPath = (ids: WorkspaceIds, requestGroupId: Id, op: RequestGroupOp) =>
  `${debugPath(ids)}/request-group/${requestGroupId}/${op}`;

export const designPath = (ids: WorkspaceIds, op: DesignOp) =>
  `${workspacePath(ids, ACTIVITY_SPEC)}/${op}`;

export const testPath = (ids: WorkspaceIds, op?: 'test-suite/new') =>
  withOp(workspacePath(ids, 'test'), op);

export const testSuitePath = (ids: WorkspaceIds, testSuiteId: Id, op?: TestSuiteOp) =>
  withOp(`${testPath(ids)}/test-suite/${testSuiteId}`, op);

export const unitTestPath = (ids: WorkspaceIds, testSuiteId: Id, testId: Id, op: UnitTestOp) =>
  `${testSuitePath(ids, testSuiteId)}/test/${testId}/${op}`;

export const testResultPath = (ids: WorkspaceIds, testSuiteId: Id, testResultId: Id) =>
  `${testSuitePath(ids, testSuiteId)}/test-result/${testResultId}`;

export const gitPath = (ids: WorkspaceIds, op: GitOp) => workspacePath(ids, `git/${op}`);
