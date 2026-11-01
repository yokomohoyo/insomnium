import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import YAML from 'yaml';
import { z } from 'zod';

import { database } from '../../../common/database';
import { appFlowRunner } from '../../../flows/flow-runner';
import { checkFlow, type FlowGraph, runFlow } from '../../../flows/run-flow';
import { ASSERTION_OPERATORS, ASSERTION_SOURCES, type AssertionOperator, type AssertionSource } from '../../../network/assertions';
import * as models from '../../../models';
import type { UnitTest } from '../../../models/unit-test';
import { isDesign } from '../../../models/workspace';
import { foreignEnvironment, redactSecrets } from './util';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

const notFound = (what: string) => text({ error: `${what} not found` }, true);

// a flow's graph as run-flow.ts runs it; a node's position and an edge's id
// can be left out, and are made up as the canvas would
const NODE_KINDS = ['start', 'request', 'condition', 'setVariable', 'delay'] as const;
const graphSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    kind: z.enum(NODE_KINDS),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    data: z.object({
      requestId: z.string().optional(),
      source: z.enum(['value', ...Object.keys(ASSERTION_SOURCES)] as [AssertionSource | 'value', ...(AssertionSource | 'value')[]]).optional(),
      property: z.string().optional(),
      operator: z.enum(Object.keys(ASSERTION_OPERATORS) as [AssertionOperator, ...AssertionOperator[]]).optional(),
      value: z.string().optional(),
      name: z.string().optional(),
      milliseconds: z.number().optional(),
    }).default({}),
  })),
  edges: z.array(z.object({
    id: z.string().optional(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.enum(['true', 'false']).optional().describe("a condition's way out"),
  })).default([]),
});

const toGraph = ({ nodes, edges }: z.infer<typeof graphSchema>): FlowGraph => ({
  nodes: nodes.map((node, index) => ({ ...node, position: node.position || { x: index * 250, y: 0 } })),
  edges: edges.map((edge, index) => ({ ...edge, id: edge.id || `e${index}-${edge.source}-${edge.target}` })),
});

const flowGraphHelp = 'graph is {nodes, edges}. A node is {id, kind, data}: kind start (exactly one, where the flow begins), request (data.requestId), condition (data.source status|header|body|jsonpath|responseTime, property (a header name or JSON path), operator equals|notEquals|contains|greaterThan|lessThan|exists|..., value; leave by edges with sourceHandle "true" and "false"), setVariable (data.name, and data.source and property, or source value and data.value: the value for {{ name }} in later requests), delay (data.milliseconds). An edge is {source, target, sourceHandle?}; each step but a condition has one way out.';

const testsOf = (suiteId: string) => database.find<UnitTest>(models.unitTest.type, { parentId: suiteId });

// What a design document holds beyond its requests: its spec, its unit test
// suites (the Test tab) and its flows
export function registerDesignTools(server: McpServer) {
  server.tool(
    'get_spec',
    "Read a design document's API spec (the Spec tab): its file name, content type (yaml or json) and contents.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace || !isDesign(workspace)) {
        return text({ error: 'workspaceId is not a design document' }, true);
      }
      const { _id, fileName, contentType, contents } = await models.apiSpec.getOrCreateForParentId(workspaceId);
      return text({ id: _id, workspaceId, fileName, contentType, contents });
    },
  );

  server.tool(
    'set_spec',
    "Set a design document's API spec (the Spec tab) to an OpenAPI or other YAML or JSON text, replacing what's there. contentType is worked out from the text when left out. Returns parseError, without saving, when the text isn't YAML or JSON.",
    { workspaceId: z.string(), contents: z.string(), contentType: z.enum(['yaml', 'json']).optional() },
    async ({ workspaceId, contents, contentType }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace || !isDesign(workspace)) {
        return text({ error: 'workspaceId is not a design document' }, true);
      }
      try {
        // YAML is a superset of JSON
        YAML.parse(contents);
      } catch (err) {
        return text({ error: 'the spec is not YAML or JSON', parseError: err instanceof Error ? err.message : String(err) }, true);
      }
      const spec = await models.apiSpec.getOrCreateForParentId(workspaceId);
      const type = contentType || (/^\s*[{[]/.test(contents) ? 'json' : 'yaml');
      await models.apiSpec.update(spec, { contents, contentType: type });
      return text({ ok: true, id: spec._id, workspaceId, contentType: type });
    },
  );

  server.tool(
    'list_test_suites',
    "List a workspace's unit test suites (the Test tab), each with its tests: name, the request it sends (requestId) and its code.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const suites = await models.unitTestSuite.findByParentId(workspaceId);
      return text(await Promise.all(suites.map(async suite => ({
        id: suite._id,
        name: suite.name,
        tests: (await testsOf(suite._id)).map(({ _id, name, requestId, code }) => ({ id: _id, name, requestId, code })),
      }))));
    },
  );

  server.tool(
    'create_test_suite',
    'Create a unit test suite in a workspace (the Test tab). Add its tests with create_unit_test.',
    { workspaceId: z.string(), name: z.string().default('New Suite') },
    async ({ workspaceId, name }) => {
      if (!await models.workspace.getById(workspaceId)) {
        return notFound('workspace');
      }
      const suite = await models.unitTestSuite.create({ parentId: workspaceId, name });
      return text({ ok: true, id: suite._id, name: suite.name });
    },
  );

  server.tool(
    'update_test_suite',
    'Rename a unit test suite.',
    { suiteId: z.string(), name: z.string().min(1) },
    async ({ suiteId, name }) => {
      const suite = await models.unitTestSuite.getById(suiteId);
      if (!suite) {
        return notFound('test suite');
      }
      await models.unitTestSuite.update(suite, { name });
      return text({ ok: true, id: suiteId, name });
    },
  );

  server.tool(
    'delete_test_suite',
    'Delete a unit test suite and its tests. This cannot be undone.',
    { suiteId: z.string() },
    async ({ suiteId }) => {
      const suite = await models.unitTestSuite.getById(suiteId);
      if (!suite) {
        return notFound('test suite');
      }
      await models.unitTestSuite.remove(suite);
      return text({ ok: true, id: suiteId });
    },
  );

  server.tool(
    'create_unit_test',
    "Add a test to a unit test suite. code is the test's body, as the app's editor has it: it runs with chai's expect, and `await insomnia.send()` sends the test's request (requestId, one in the workspace) and returns its response, e.g. `const response = await insomnia.send();\nexpect(response.status).to.equal(200);`.",
    { suiteId: z.string(), name: z.string().default('New Test'), code: z.string(), requestId: z.string().optional() },
    async ({ suiteId, name, code, requestId }) => {
      if (!await models.unitTestSuite.getById(suiteId)) {
        return notFound('test suite');
      }
      if (requestId && !await models.request.getById(requestId)) {
        return notFound('request');
      }
      const test = await models.unitTest.create({ parentId: suiteId, name, code, requestId: requestId || null });
      return text({ ok: true, id: test._id, name: test.name });
    },
  );

  server.tool(
    'update_unit_test',
    "Change a unit test's name, code or request (requestId; null for none).",
    { testId: z.string(), name: z.string().optional(), code: z.string().optional(), requestId: z.string().nullable().optional() },
    async ({ testId, name, code, requestId }) => {
      const test = await database.getWhere<UnitTest>(models.unitTest.type, { _id: testId });
      if (!test) {
        return notFound('unit test');
      }
      if (requestId && !await models.request.getById(requestId)) {
        return notFound('request');
      }
      await models.unitTest.update(test, {
        ...(name !== undefined ? { name } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      });
      return text({ ok: true, id: testId });
    },
  );

  server.tool(
    'delete_unit_test',
    'Delete a unit test.',
    { testId: z.string() },
    async ({ testId }) => {
      const test = await database.getWhere<UnitTest>(models.unitTest.type, { _id: testId });
      if (!test) {
        return notFound('unit test');
      }
      await models.unitTest.remove(test);
      return text({ ok: true, id: testId });
    },
  );

  server.tool(
    'list_flows',
    "List a workspace's flows (the Flows tab): id, name, description and how many steps each has. get_flow reads one's graph.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const flows = await models.flow.findByParentId(workspaceId);
      return text(flows.map(({ _id, name, description, graph }) => ({ id: _id, name, description, steps: graph.nodes.length })));
    },
  );

  server.tool(
    'get_flow',
    "Read a flow: its name, description and graph (its steps, and the arrows between them), and what's wrong with it, if anything, before it can run.",
    { flowId: z.string() },
    async ({ flowId }) => {
      const flow = await models.flow.getById(flowId);
      if (!flow) {
        return notFound('flow');
      }
      const { _id, parentId, name, description, graph } = flow;
      return text({ id: _id, workspaceId: parentId, name, description, graph, problem: checkFlow(graph) });
    },
  );

  server.tool(
    'create_flow',
    `Create a flow in a workspace (the Flows tab): its requests, run along arrows from its start, with conditions, variables and delays between them. Without a graph it has just its start. ${flowGraphHelp} Returns problem when the flow can't run yet.`,
    { workspaceId: z.string(), name: z.string().default('New Flow'), description: z.string().optional(), graph: graphSchema.optional() },
    async ({ workspaceId, name, description, graph }) => {
      if (!await models.workspace.getById(workspaceId)) {
        return notFound('workspace');
      }
      const flow = await models.flow.create({ parentId: workspaceId, name, ...(description ? { description } : {}), ...(graph ? { graph: toGraph(graph) } : {}) });
      return text({ ok: true, id: flow._id, name: flow.name, problem: checkFlow(flow.graph) });
    },
  );

  server.tool(
    'update_flow',
    `Change a flow's name or description, or replace its graph. ${flowGraphHelp} Returns problem when the flow can't run yet.`,
    { flowId: z.string(), name: z.string().optional(), description: z.string().optional(), graph: graphSchema.optional() },
    async ({ flowId, name, description, graph }) => {
      const flow = await models.flow.getById(flowId);
      if (!flow) {
        return notFound('flow');
      }
      const updated = await models.flow.update(flow, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(graph ? { graph: toGraph(graph) } : {}),
      });
      return text({ ok: true, id: flowId, problem: checkFlow(updated.graph) });
    },
  );

  server.tool(
    'run_flow',
    "Run a flow as its Run button does: from its start along its arrows, each request sent with its scripts and assertions (and its response stored), each condition checked, each variable set, each delay waited. Returns whether it passed, its message, each step's result (nodeId, kind, status passed/failed/true/false, message, the response's status and time), and the variables it ended with. variables are values for {{ name }} before it starts; stopAfterSeconds stops a flow that runs too long.",
    {
      flowId: z.string(),
      environmentId: z.string().nullable().optional().describe('a sub environment to run in; the active one when left out, null for the base environment'),
      variables: z.record(z.string(), z.string()).optional(),
      stopAfterSeconds: z.number().int().min(1).max(3600).default(600),
    },
    async ({ flowId, environmentId, variables, stopAfterSeconds }) => {
      const flow = await models.flow.getById(flowId);
      if (!flow) {
        return notFound('flow');
      }
      const workspaceId = flow.parentId;
      const foreign = await foreignEnvironment(workspaceId, environmentId);
      if (foreign) {
        return text({ error: foreign }, true);
      }
      // values, not templates: one rendered could read a file or a secret, or
      // another request's response, into a request
      const template = Object.entries(variables || {}).find(([, value]) => /{{|{%/.test(value));
      if (template) {
        return text({ error: `variable '${template[0]}' is a template: variables are values, not templates` }, true);
      }
      const environment = environmentId === undefined ? (await models.workspaceMeta.getOrCreateByParentId(workspaceId)).activeEnvironmentId : environmentId;
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), stopAfterSeconds * 1000);
      try {
        const result = await runFlow(flow.graph, appFlowRunner({ workspaceId, environmentId: environment || undefined }), { signal: stop.signal, variables });
        // a variable taken from a response can be a token: masked as
        // get_request masks one, in its step's message too
        const shown = redactSecrets(result.variables);
        const steps = result.steps.map(step => {
          const name = step.kind === 'setVariable' && step.status === 'passed' ? step.message.split(' = ')[0] : '';
          return name && shown[name] !== result.variables[name] ? { ...step, message: `${name} = ${shown[name]}` } : step;
        });
        return text({ passed: result.passed, message: result.message, steps, variables: shown }, !result.passed);
      } finally {
        clearTimeout(timer);
      }
    },
  );

  server.tool(
    'delete_flow',
    'Delete a flow.',
    { flowId: z.string() },
    async ({ flowId }) => {
      const flow = await models.flow.getById(flowId);
      if (!flow) {
        return notFound('flow');
      }
      await models.flow.remove(flow);
      return text({ ok: true, id: flowId });
    },
  );
}
