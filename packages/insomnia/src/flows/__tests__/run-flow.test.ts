import { describe, expect, it, jest } from '@jest/globals';

import { checkFlow, type FlowEdge, type FlowGraph, type FlowNode, type FlowResponse, MAX_STEPS, runFlow } from '../run-flow';

const node = (id: string, kind: FlowNode['kind'], data: FlowNode['data'] = {}): FlowNode => ({ id, kind, data, position: { x: 0, y: 0 } });
const edge = (source: string, target: string, sourceHandle?: string): FlowEdge => ({ id: `${source}-${target}-${sourceHandle || ''}`, source, target, sourceHandle });

const json = (statusCode: number, body: unknown): FlowResponse => ({ statusCode, statusMessage: statusCode === 200 ? 'OK' : 'Not Found', headers: [], elapsedTime: 12, body: JSON.stringify(body) });

// log in, keep the token, and fetch the pets with it; or say why not
const login: FlowGraph = {
  nodes: [
    node('start', 'start'),
    node('login', 'request', { requestId: 'req_login' }),
    node('ok', 'condition', { source: 'status', operator: 'equals', value: '200' }),
    node('token', 'setVariable', { name: 'token', source: 'jsonpath', property: '$.token' }),
    node('pets', 'request', { requestId: 'req_pets' }),
    node('note', 'setVariable', { name: 'why', source: 'value', value: 'login failed' }),
  ],
  edges: [edge('start', 'login'), edge('login', 'ok'), edge('ok', 'token', 'true'), edge('ok', 'note', 'false'), edge('token', 'pets')],
};

describe('runFlow', () => {
  it('sends its requests in order, branching on the response and carrying variables to the next', async () => {
    const send = jest.fn(async (requestId: string, variables: Record<string, string>) => requestId === 'req_login' ? json(200, { token: 'abc' }) : json(200, { pets: [], auth: variables.token }));
    const onStep = jest.fn();
    const result = await runFlow(login, { send }, { onStep });

    expect(result).toMatchObject({ passed: true, message: 'Done', variables: { token: 'abc' } });
    expect(send.mock.calls.map(([id, variables]) => [id, { ...variables }])).toEqual([['req_login', {}], ['req_pets', { token: 'abc' }]]);
    expect(result.steps.map(({ nodeId, status }) => `${nodeId}:${status}`)).toEqual(['start:passed', 'login:passed', 'ok:true', 'token:passed', 'pets:passed']);
    expect(result.steps[1]).toMatchObject({ message: '200 OK', response: { statusCode: 200, elapsedTime: 12 } });
    // each step is reported as it starts, and as it ends
    expect(onStep.mock.calls.filter(([step]) => (step as { status: string }).status === 'running')).toHaveLength(5);
  });

  it("goes the other way when the condition doesn't hold", async () => {
    const result = await runFlow(login, { send: async () => json(404, {}) });
    expect(result.passed).toBe(true);
    expect(result.steps.map(({ nodeId, status }) => `${nodeId}:${status}`)).toEqual(['start:passed', 'login:passed', 'ok:false', 'note:passed']);
    expect(result.variables).toEqual({ why: 'login failed' });
  });

  it('renders a value given as text, and stops at the step that fails', async () => {
    const render = jest.fn(async (text: string) => text.replace('{{ who }}', 'kim'));
    const graph: FlowGraph = {
      nodes: [node('start', 'start'), node('greet', 'setVariable', { name: 'greeting', source: 'value', value: 'hi {{ who }}' }), node('send', 'request', { requestId: 'req_1' })],
      edges: [edge('start', 'greet'), edge('greet', 'send')],
    };
    const result = await runFlow(graph, { send: async () => {
      throw new Error('connect ECONNREFUSED');
    }, render });
    expect(result).toMatchObject({ passed: false, message: 'connect ECONNREFUSED', variables: { greeting: 'hi kim' } });
    expect(result.steps.at(-1)).toMatchObject({ nodeId: 'send', status: 'failed' });
  });

  it("checks a condition against a value with the flow's variables", async () => {
    const render = async (text: string, variables: Record<string, string>) => text.replace('{{ expected }}', variables.expected);
    const graph: FlowGraph = {
      nodes: [
        node('start', 'start'),
        node('expect', 'setVariable', { name: 'expected', source: 'value', value: 'abc' }),
        node('get', 'request', { requestId: 'req_1' }),
        node('same', 'condition', { source: 'jsonpath', property: '$.token', operator: 'equals', value: '{{ expected }}' }),
      ],
      edges: [edge('start', 'expect'), edge('expect', 'get'), edge('get', 'same')],
    };
    const result = await runFlow(graph, { send: async () => json(200, { token: 'abc' }), render });
    expect(result.steps.at(-1)).toMatchObject({ nodeId: 'same', status: 'true' });
  });

  it("says what's missing from a step", async () => {
    const graph = (step: FlowNode): FlowGraph => ({ nodes: [node('start', 'start'), step], edges: [edge('start', step.id)] });
    const send = async () => json(200, {});
    expect((await runFlow(graph(node('r', 'request')), { send })).message).toBe('Choose the request it sends.');
    expect((await runFlow(graph(node('c', 'condition', { source: 'status', operator: 'equals', value: '200' })), { send })).message).toContain('no response yet');
    expect((await runFlow(graph(node('v', 'setVariable', { name: 'two words' })), { send })).message).toContain('Give the variable a name');
  });

  it('polls round a loop, and gives up on one that never ends', async () => {
    // ask until it's ready: the third time
    let asked = 0;
    const polling: FlowGraph = {
      nodes: [node('start', 'start'), node('ask', 'request', { requestId: 'req_status' }), node('ready', 'condition', { source: 'jsonpath', property: '$.state', operator: 'equals', value: 'ready' }), node('wait', 'delay', { milliseconds: 1000 })],
      edges: [edge('start', 'ask'), edge('ask', 'ready'), edge('ready', 'wait', 'false'), edge('wait', 'ask')],
    };
    const wait = jest.fn(async () => {});
    const result = await runFlow(polling, { send: async () => json(200, { state: ++asked === 3 ? 'ready' : 'pending' }), wait });
    expect(result.passed).toBe(true);
    expect(asked).toBe(3);
    expect(wait).toHaveBeenCalledTimes(2);

    const forever = await runFlow(polling, { send: async () => json(200, { state: 'pending' }), wait });
    expect(forever).toMatchObject({ passed: false, message: `Stopped after ${MAX_STEPS} steps: the flow goes round and round.` });
  });

  it('stops when asked to', async () => {
    const controller = new AbortController();
    const graph: FlowGraph = { nodes: [node('start', 'start'), node('wait', 'delay', { milliseconds: 60_000 })], edges: [edge('start', 'wait')] };
    const running = runFlow(graph, { send: async () => json(200, {}) }, { signal: controller.signal });
    controller.abort();
    expect(await running).toMatchObject({ passed: false, message: 'Stopped' });
  });
});

describe('checkFlow', () => {
  it('needs one Start, and one arrow out of each step but a condition', () => {
    expect(checkFlow({ nodes: [], edges: [] })).toBe('Add a Flow Start, where the flow begins.');
    expect(checkFlow({ nodes: [node('a', 'start'), node('b', 'start')], edges: [] })).toBe('A flow has one Flow Start.');
    expect(checkFlow({ nodes: [node('a', 'start'), node('b', 'delay'), node('c', 'delay')], edges: [edge('a', 'b'), edge('a', 'c')] })).toContain('one arrow out of it');
    expect(checkFlow(login)).toBeUndefined();
  });
});
