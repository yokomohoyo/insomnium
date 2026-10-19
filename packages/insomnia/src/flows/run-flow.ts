// A flow: a collection's requests on a canvas, joined by arrows, which runs
// from its Start along them. A request sends, and the next step sees its
// response; a condition goes one way or the other on it (as an assertion
// checks it); a variable takes a value from it for the requests after; a
// delay waits. Each step is reported as it runs.
import { t } from '../common/i18n';
import { type AssertionOperator, type AssertionSource, evaluateAssertions, type ResponseUnderTest, responseValue } from '../network/assertions';

export type FlowNodeKind = 'start' | 'request' | 'condition' | 'setVariable' | 'delay';

// (a type, not an interface, so that it is a record, as a canvas node's data must be)
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see above
export type FlowNodeData = {
  // request: the request it sends
  requestId?: string;
  // condition: what it checks of the last response; setVariable: where the value comes from
  source?: AssertionSource | 'value';
  property?: string;
  operator?: AssertionOperator;
  value?: string;
  // setVariable: the variable's name, which requests after it can use as {{ name }}
  name?: string;
  // delay
  milliseconds?: number;
};

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  // a condition's: 'true' or 'false'
  sourceHandle?: string | null;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowResponse extends ResponseUnderTest {
  statusMessage?: string;
}

export type FlowStepStatus = 'running' | 'passed' | 'failed' | 'true' | 'false';

export interface FlowStep {
  nodeId: string;
  kind: FlowNodeKind;
  status: FlowStepStatus;
  message: string;
  // a request's response, in brief
  response?: { statusCode?: number; statusMessage?: string; elapsedTime?: number; size: number };
}

export interface FlowRunner {
  // sends a request of the collection with the flow's variables over its environment
  send(requestId: string, variables: Record<string, string>, signal: AbortSignal): Promise<FlowResponse>;
  // renders a variable's value (it can use {{ variables }} and tags)
  render?(text: string, variables: Record<string, string>): Promise<string>;
  wait?(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface FlowResult {
  passed: boolean;
  steps: FlowStep[];
  variables: Record<string, string>;
  message: string;
}

// a flow that loops goes round this many steps at most
export const MAX_STEPS = 1000;
const MAX_DELAY = 10 * 60 * 1000;

const sleep = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new Error(t('Stopped')));
  }, { once: true });
});

// the way out of a step: a condition's by its result, another's by its one arrow
export function nextNode(graph: FlowGraph, node: FlowNode, branch?: 'true' | 'false') {
  const out = graph.edges.filter(edge => edge.source === node.id && (branch ? edge.sourceHandle === branch : !edge.sourceHandle || edge.sourceHandle === 'out'));
  return out.length ? graph.nodes.find(candidate => candidate.id === out[0].target) : undefined;
}

// what's wrong with a flow before it runs, if anything
export function checkFlow(graph: FlowGraph): string | undefined {
  const starts = graph.nodes.filter(node => node.kind === 'start');
  if (starts.length !== 1) {
    return starts.length ? t('A flow has one Flow Start.') : t('Add a Flow Start, where the flow begins.');
  }
  for (const node of graph.nodes) {
    const ways = graph.edges.filter(edge => edge.source === node.id);
    if (node.kind === 'condition') {
      for (const branch of ['true', 'false']) {
        if (ways.filter(edge => edge.sourceHandle === branch).length > 1) {
          return t('A condition has one arrow for each of its ways.');
        }
      }
    } else if (ways.length > 1) {
      return t('A step has one arrow out of it: add a condition to go two ways.');
    }
  }
  return undefined;
}

export async function runFlow(graph: FlowGraph, runner: FlowRunner, { onStep, signal = new AbortController().signal, variables: initial = {} }: {
  onStep?: (step: FlowStep) => void;
  signal?: AbortSignal;
  variables?: Record<string, string>;
} = {}): Promise<FlowResult> {
  const steps: FlowStep[] = [];
  const variables = { ...initial };
  const report = (step: FlowStep) => {
    if (step.status !== 'running') {
      steps.push(step);
    }
    onStep?.(step);
  };
  const done = (passed: boolean, message: string): FlowResult => ({ passed, steps, variables, message });

  const problem = checkFlow(graph);
  if (problem) {
    return done(false, problem);
  }
  let node: FlowNode | undefined = graph.nodes.find(candidate => candidate.kind === 'start');
  let last: FlowResponse | undefined;

  for (let count = 0; node; count++) {
    if (signal.aborted) {
      return done(false, t('Stopped'));
    }
    if (count >= MAX_STEPS) {
      return done(false, t('Stopped after {steps} steps: the flow goes round and round.', { steps: MAX_STEPS }));
    }
    const { id: nodeId, kind, data } = node;
    report({ nodeId, kind, status: 'running', message: '' });
    try {
      let branch: 'true' | 'false' | undefined;
      if (kind === 'start') {
        report({ nodeId, kind, status: 'passed', message: t('Started') });
      } else if (kind === 'request') {
        if (!data.requestId) {
          throw new Error(t('Choose the request it sends.'));
        }
        // the variables as they are now, which the steps after it can change
        last = await runner.send(data.requestId, { ...variables }, signal);
        report({
          nodeId,
          kind,
          status: 'passed',
          message: `${last.statusCode ?? ''} ${last.statusMessage ?? ''}`.trim(),
          response: { statusCode: last.statusCode, statusMessage: last.statusMessage, elapsedTime: last.elapsedTime, size: last.body.length },
        });
      } else if (kind === 'condition') {
        if (!last) {
          throw new Error(t('There is no response yet: send a request before it.'));
        }
        if (!data.source || data.source === 'value' || !data.operator) {
          throw new Error(t('Choose what it checks.'));
        }
        // the value it's checked against can use the flow's variables, as an assertion's can
        const value = data.value && runner.render ? await runner.render(data.value, { ...variables }) : data.value;
        const [result] = evaluateAssertions([{ id: nodeId, source: data.source, property: data.property, operator: data.operator, value }], last);
        branch = result.passed ? 'true' : 'false';
        report({ nodeId, kind, status: branch, message: result.message });
      } else if (kind === 'setVariable') {
        const name = (data.name || '').trim();
        // as {{ name }} reads it: a '-' would be a minus
        if (!/^[A-Za-z_]\w*$/.test(name)) {
          throw new Error(t('Give the variable a name: letters, digits and _, not starting with a digit.'));
        }
        let value: string | undefined;
        if (!data.source || data.source === 'value') {
          value = runner.render ? await runner.render(data.value || '', { ...variables }) : data.value || '';
        } else {
          if (!last) {
            throw new Error(t('There is no response yet: send a request before it.'));
          }
          value = responseValue(data.source, data.property, last);
        }
        variables[name] = value ?? '';
        report({ nodeId, kind, status: 'passed', message: `${name} = ${JSON.stringify((value ?? '').length > 200 ? `${value?.slice(0, 200)}…` : value ?? '')}` });
      } else if (kind === 'delay') {
        const milliseconds = Math.min(Math.max(Number(data.milliseconds) || 0, 0), MAX_DELAY);
        await (runner.wait || sleep)(milliseconds, signal);
        report({ nodeId, kind, status: 'passed', message: t('Waited {milliseconds} ms', { milliseconds }) });
      }
      node = nextNode(graph, node, branch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report({ nodeId, kind, status: 'failed', message });
      return done(false, signal.aborted ? t('Stopped') : message);
    }
  }
  return done(true, t('Done'));
}
