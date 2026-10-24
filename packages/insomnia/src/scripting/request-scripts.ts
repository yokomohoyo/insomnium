import { database as db } from '../common/database';
import { getGlobalEnvironments } from '../common/global-environments';
import { MAX_VISUALIZATION_LENGTH, type Visualization } from '../common/visualizer';
import type { ResponsePatch } from '../main/network/libcurl-promise';
import * as models from '../models';
import type { Environment } from '../models/environment';
import type { Request, RequestBodyParameter, RequestHeader, RequestParameter } from '../models/request';
import { setEnvironmentData, withSecretValues } from '../common/environment-secrets';
import { isProject } from '../models/project';
import { isWorkspace } from '../models/workspace';
import type { AssertionResult } from '../network/assertions';
import { runInSandbox, ScriptLog } from './sandbox';

// A request's scripts: the pre-request one before it's rendered (it can change
// the request and set variables the render then uses), the after-response one
// on the response (it can check it with tests, which join the assertions, and
// keep values from it in the environment).

interface ScriptRequest {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: { name: string; value: string; disabled?: boolean }[];
  parameters: { name: string; value: string; disabled?: boolean }[];
  body: { mimeType?: string | null; text?: string; params?: RequestBodyParameter[] };
}

interface ScriptOutput {
  request: ScriptRequest;
  environment: Record<string, unknown>;
  baseEnvironment: Record<string, unknown>;
  globals: Record<string, unknown>;
  variables: Record<string, unknown>;
  tests: { name: string; passed: boolean; error?: string }[];
  // set with visualizer.set
  visualization?: Visualization | null;
}

export const hasScript = (script?: string) => !!script?.trim();

const toScriptRequest = (request: Request): ScriptRequest => ({
  id: request._id,
  name: request.name,
  url: request.url,
  method: request.method,
  headers: request.headers.map(({ name, value, disabled }) => ({ name, value, ...(disabled ? { disabled } : {}) })),
  parameters: request.parameters.map(({ name, value, disabled }) => ({ name, value, ...(disabled ? { disabled } : {}) })),
  body: { mimeType: request.body.mimeType, text: request.body.text, params: request.body.params },
});

// The request as the script left it, for this send; the saved one is unchanged
const fromScriptRequest = (request: Request, changed: ScriptRequest): Request => ({
  ...request,
  url: changed.url,
  method: changed.method,
  headers: changed.headers as RequestHeader[],
  parameters: changed.parameters as RequestParameter[],
  body: changed.body.text === request.body.text ? request.body : { ...request.body, text: changed.body.text },
});

// The environments a script sees: the base one, and the sub environment in
// use when there is one; otherwise `environment` is the base one too. Its
// globals are the project's global environment in use, or its global base.
async function environmentsFor(request: Request, environmentId?: string | null) {
  const ancestors = await db.withAncestors(request, [models.requestGroup.type, models.workspace.type, models.project.type]);
  const workspace = ancestors.find(isWorkspace);
  if (!workspace) {
    throw new Error('Could not find the workspace to run the script in');
  }
  // with their secret variables' values, which a script can read and set
  const base = await withSecretValues(await models.environment.getOrCreateForParentId(workspace._id));
  const chosen = environmentId ? await withSecretValues(await models.environment.getById(environmentId)) : null;
  const projectId = ancestors.find(isProject)?._id || null;
  const found = await getGlobalEnvironments(projectId, workspace._id);
  const globals = { base: await withSecretValues(found.base), active: await withSecretValues(found.active) };
  return { base, active: chosen && chosen._id !== base._id ? chosen : null, projectId, globals };
}

type Environments = Awaited<ReturnType<typeof environmentsFor>>;

const sameData = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function saveEnvironments({ base, active, projectId, globals }: Environments, output: ScriptOutput) {
  // (a secret variable's value goes back to its secrets, not the data)
  if (active && !sameData(active.data, output.environment)) {
    await setEnvironmentData(active, output.environment);
  }
  if (!sameData(base.data, active ? output.baseEnvironment : output.environment)) {
    await setEnvironmentData(base, active ? output.baseEnvironment : output.environment);
  }
  const global: Environment | null = globals.active || globals.base;
  if (!sameData(global?.data || {}, output.globals) && projectId) {
    await setEnvironmentData(global || await models.environment.getOrCreateForParentId(projectId), output.globals);
  }
}

interface ScriptContext {
  environmentId?: string | null;
  iterationData?: Record<string, unknown>;
  iteration?: number;
}

async function run(event: 'prerequest' | 'test', script: string, request: Request, context: ScriptContext, response?: object) {
  const environments = await environmentsFor(request, context.environmentId);
  const { base, active, globals } = environments;
  const result = await runInSandbox<ScriptOutput>(script, {
    event,
    request: toScriptRequest(request),
    response,
    environment: (active || base).data,
    baseEnvironment: base.data,
    environmentIsBase: !active,
    globals: (globals.active || globals.base)?.data || {},
    // read under the globals in use, as the render does
    globalBase: globals.active ? globals.base?.data : undefined,
    variables: {},
    iterationData: context.iterationData || {},
    iteration: context.iteration || 0,
    tests: [],
  });
  if (result.output) {
    await saveEnvironments(environments, result.output);
  }
  return result;
}

export interface PreRequestResult {
  request: Request;
  // set with insomnia.variables: rendered above everything else
  variables: Record<string, unknown>;
  logs: ScriptLog[];
}

// A failed pre-request script stops the send: the request may not be what it
// should be
export async function runPreRequestScript(request: Request, context: ScriptContext = {}): Promise<PreRequestResult> {
  if (!hasScript(request.preRequestScript)) {
    return { request, variables: {}, logs: [] };
  }
  const result = await run('prerequest', request.preRequestScript!, request, context);
  if (result.error || !result.output) {
    throw Object.assign(new Error(`The pre-request script failed: ${result.error}`), { scriptLogs: result.logs });
  }
  return { request: fromScriptRequest(request, result.output.request), variables: result.output.variables, logs: result.logs };
}

const asText = (response: ResponsePatch) => {
  const body = models.response.getBodyBuffer(response, '');
  return body ? body.toString() : '';
};

export interface AfterResponseResult {
  results: AssertionResult[];
  logs: ScriptLog[];
  visualization?: Visualization;
}

// The after-response script's tests, and its failure as a failed one, and
// what it set to visualize the response
export async function runAfterResponseScript(request: Request, response: ResponsePatch, context: ScriptContext = {}): Promise<AfterResponseResult> {
  if (!hasScript(request.afterResponseScript) || response.error) {
    return { results: [], logs: [] };
  }
  const result = await run('test', request.afterResponseScript!, request, context, {
    code: response.statusCode || 0,
    status: response.statusMessage || '',
    headers: (response.headers || []).map(({ name, value }) => ({ name, value })),
    body: asText(response),
    responseTime: response.elapsedTime,
  });
  const results: AssertionResult[] = (result.output?.tests || []).map((test, index) => ({
    id: `script_test_${index + 1}`,
    passed: test.passed,
    message: test.passed ? test.name : `${test.name}: ${test.error}`,
  }));
  if (result.error) {
    results.push({ id: 'script_error', passed: false, message: `The after-response script failed: ${result.error}` });
  }
  const visualization = result.output?.visualization;
  if (visualization && JSON.stringify(visualization).length > MAX_VISUALIZATION_LENGTH) {
    results.push({ id: 'script_visualization', passed: false, message: `The visualization is larger than ${MAX_VISUALIZATION_LENGTH / 1024 / 1024} MB: visualize less of the response` });
    return { results, logs: result.logs };
  }
  return { results, logs: result.logs, ...(visualization ? { visualization } : {}) };
}
