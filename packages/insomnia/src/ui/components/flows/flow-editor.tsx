import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import classnames from 'classnames';
import React, { createContext, FC, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { generateId } from '../../../common/misc';
import { appFlowRunner } from '../../../flows/flow-runner';
import { type FlowEdge, type FlowGraph, type FlowNode, type FlowNodeData, type FlowNodeKind, type FlowResult, type FlowStep, runFlow } from '../../../flows/run-flow';
import * as models from '../../../models';
import { type Flow, START_NODE_ID } from '../../../models/flow';
import { ASSERTION_OPERATORS, ASSERTION_SOURCES, type AssertionOperator, type AssertionSource, operatorHasValue, sourceHasProperty } from '../../../network/assertions';
import type { FlowRequest } from '../../routes/flows';
import type { WorkspaceLoaderData } from '../../routes/workspace';

type CanvasNode = Node<FlowNodeData, FlowNodeKind>;

const KIND_NAMES: Record<FlowNodeKind, () => string> = {
  start: () => t('Flow Start'),
  request: () => t('Request'),
  condition: () => t('Condition'),
  setVariable: () => t('Set Variable'),
  delay: () => t('Delay'),
};

const ADDABLE: Exclude<FlowNodeKind, 'start'>[] = ['request', 'condition', 'setVariable', 'delay'];

const toCanvas = (graph: FlowGraph): { nodes: CanvasNode[]; edges: Edge[] } => ({
  nodes: graph.nodes.map(({ id, kind, position, data }) => ({ id, type: kind, position, data, deletable: kind !== 'start' })),
  edges: graph.edges.map(edgeOnCanvas),
});

const branchLabel = (handle?: string | null) => (handle === 'true' ? t('Yes') : handle === 'false' ? t('No') : undefined);

const edgeOnCanvas = ({ id, source, target, sourceHandle }: FlowEdge): Edge => ({ id, source, target, sourceHandle: sourceHandle ?? null, label: branchLabel(sourceHandle) });

const fromCanvas = (nodes: CanvasNode[], edges: Edge[]): FlowGraph => ({
  nodes: nodes.map(({ id, type, position, data }) => ({ id, kind: type as FlowNodeKind, position: { x: Math.round(position.x), y: Math.round(position.y) }, data })),
  edges: edges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) })),
});

// what the nodes show: the requests' names, and each one's last step in a run
const CanvasContext = createContext<{ requests: Map<string, FlowRequest>; steps: Record<string, FlowStep | undefined> }>({ requests: new Map(), steps: {} });

const STATUS_COLOURS: Record<FlowStep['status'], string> = {
  running: 'border-[--color-info]',
  passed: 'border-[--color-success]',
  true: 'border-[--color-success]',
  false: 'border-[--color-warning]',
  failed: 'border-[--color-danger]',
};

// what a step does, in a line
const useSummary = (kind: FlowNodeKind, data: FlowNodeData) => {
  const { requests } = useContext(CanvasContext);
  switch (kind) {
    case 'start':
      return t('Where the flow begins');
    case 'request': {
      const request = data.requestId ? requests.get(data.requestId) : undefined;
      return request ? `${request.method} ${request.name}` : data.requestId ? t('A request no longer here') : t('Choose a request');
    }
    case 'condition':
      return data.source && data.source !== 'value' && data.operator
        ? [ASSERTION_SOURCES[data.source], data.property, ASSERTION_OPERATORS[data.operator], operatorHasValue(data.operator) ? data.value : ''].filter(Boolean).join(' ')
        : t('Choose what it checks');
    case 'setVariable':
      return data.name ? `${data.name} = ${!data.source || data.source === 'value' ? data.value || '' : [ASSERTION_SOURCES[data.source], data.property].filter(Boolean).join(' ')}` : t('Name the variable');
    default:
      return t('{milliseconds} ms', { milliseconds: Number(data.milliseconds) || 0 });
  }
};

const StepNode: FC<NodeProps<CanvasNode>> = ({ id, type, data, selected }) => {
  const { steps } = useContext(CanvasContext);
  const step = steps[id];
  const summary = useSummary(type, data);
  return (
    <div
      data-testid={`flow-node-${type}`}
      aria-label={`${KIND_NAMES[type]()}: ${summary}`}
      className={classnames(
        'min-w-[11rem] max-w-[18rem] rounded-md border-2 border-solid bg-[--color-bg] text-[--color-font] px-[--padding-sm] py-[--padding-xs] text-[--font-size-sm] shadow-sm',
        step ? STATUS_COLOURS[step.status] : 'border-[--hl-md]',
        { 'outline outline-2 outline-[--color-surprise] outline-offset-2': selected },
      )}
    >
      {type !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className="font-semibold uppercase text-[--font-size-xs] text-[--hl]">{KIND_NAMES[type]()}</div>
      <div className="truncate" title={summary}>{summary}</div>
      {step && step.status !== 'running' && step.message && <div className="truncate text-[--font-size-xs] text-[--hl]" title={step.message}>{step.message}</div>}
      {type === 'condition' ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: '30%', background: 'var(--color-success)' }} title={t('Yes')} />
          <Handle id="false" type="source" position={Position.Right} style={{ top: '70%', background: 'var(--color-warning)' }} title={t('No')} />
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
};

const NODE_TYPES = { start: StepNode, request: StepNode, condition: StepNode, setVariable: StepNode, delay: StepNode };

const Field: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-[--padding-xxs] text-[--font-size-sm]">
    <span className="text-[--hl]">{label}</span>
    {children}
  </label>
);

const inputClass = 'w-full rounded-sm border border-solid border-[--hl-sm] bg-[--color-bg] text-[--color-font] px-[--padding-xs] py-[--padding-xxs]';

// the selected step's settings
const Inspector: FC<{ node: CanvasNode; requests: FlowRequest[]; onChange: (data: Partial<FlowNodeData>) => void; onDelete: () => void }> = ({ node, requests, onChange, onDelete }) => {
  const { type, data } = node;
  const responseSources = Object.entries(ASSERTION_SOURCES) as [AssertionSource, string][];
  return (
    <section aria-label={t('Step')} className="flex flex-col gap-[--padding-sm]">
      <h3 className="m-0 text-[--font-size-md]">{KIND_NAMES[type]()}</h3>
      {type === 'start' && <p className="m-0 faint">{t('The flow begins here and follows the arrows. Add a step after the one selected with the buttons above, or draw an arrow from a step\'s right edge to another.')}</p>}
      {type === 'request' && (
        <Field label={t('Request')}>
          <select className={inputClass} value={data.requestId || ''} onChange={event => onChange({ requestId: event.currentTarget.value || undefined })}>
            <option value="">{t('Choose a request')}</option>
            {requests.map(request => (
              <option key={request._id} value={request._id}>{[...request.folders, `${request.method} ${request.name}`].join(' / ')}</option>
            ))}
          </select>
        </Field>
      )}
      {type === 'condition' && (
        <>
          <Field label={t('Checks')}>
            <select className={inputClass} value={data.source && data.source !== 'value' ? data.source : ''} onChange={event => onChange({ source: event.currentTarget.value as AssertionSource })}>
              {!data.source && <option value="">{t('Choose')}</option>}
              {responseSources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {data.source && data.source !== 'value' && sourceHasProperty(data.source) && (
            <Field label={data.source === 'header' ? t('Header') : t('JSON path')}>
              <input className={inputClass} value={data.property || ''} placeholder={data.source === 'header' ? 'Content-Type' : '$.data.id'} onChange={event => onChange({ property: event.currentTarget.value })} />
            </Field>
          )}
          <Field label={t('Operator')}>
            <select className={inputClass} value={data.operator || ''} onChange={event => onChange({ operator: event.currentTarget.value as AssertionOperator })}>
              {!data.operator && <option value="">{t('Choose')}</option>}
              {Object.entries(ASSERTION_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {(!data.operator || operatorHasValue(data.operator)) && (
            <Field label={t('Value')}>
              <input className={inputClass} value={data.value || ''} placeholder={t('value or {{ variable }}')} onChange={event => onChange({ value: event.currentTarget.value })} />
            </Field>
          )}
          <p className="m-0 faint text-[--font-size-sm]">{t('It checks the last response: the flow follows its Yes arrow when the check holds, and its No arrow when it doesn\'t.')}</p>
        </>
      )}
      {type === 'setVariable' && (
        <>
          <Field label={t('Name')}>
            <input className={inputClass} value={data.name || ''} placeholder="token" onChange={event => onChange({ name: event.currentTarget.value })} />
          </Field>
          <Field label={t('Value from')}>
            <select className={inputClass} value={data.source || 'value'} onChange={event => onChange({ source: event.currentTarget.value as AssertionSource | 'value' })}>
              <option value="value">{t('Text')}</option>
              {responseSources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {data.source && data.source !== 'value' && sourceHasProperty(data.source) && (
            <Field label={data.source === 'header' ? t('Header') : t('JSON path')}>
              <input className={inputClass} value={data.property || ''} placeholder={data.source === 'header' ? 'Location' : '$.token'} onChange={event => onChange({ property: event.currentTarget.value })} />
            </Field>
          )}
          {(!data.source || data.source === 'value') && (
            <Field label={t('Value')}>
              <input className={inputClass} value={data.value || ''} placeholder={t('value or {{ variable }}')} onChange={event => onChange({ value: event.currentTarget.value })} />
            </Field>
          )}
          <p className="m-0 faint text-[--font-size-sm]">{t('The requests after it can use it as {example}, over the environment\'s variables.', { example: `{{ ${data.name || 'name'} }}` })}</p>
        </>
      )}
      {type === 'delay' && (
        <Field label={t('Milliseconds')}>
          <input className={inputClass} type="number" min={0} max={600000} step={100} value={data.milliseconds ?? 0} onChange={event => onChange({ milliseconds: Number(event.currentTarget.value) })} />
        </Field>
      )}
      {type !== 'start' && (
        <button className="btn btn--clicky btn--compact self-start" onClick={onDelete}>
          <i className="fa fa-trash-o space-right" />{t('Delete Step')}
        </button>
      )}
    </section>
  );
};

const STEP_ICONS: Record<FlowStep['status'], string> = {
  running: 'fa-circle-o-notch fa-spin',
  passed: 'fa-check text-[--color-success]',
  true: 'fa-check text-[--color-success]',
  false: 'fa-times text-[--color-warning]',
  failed: 'fa-exclamation-circle text-[--color-danger]',
};

// a flow on its canvas, with the selected step's settings and the last run beside it
const Editor: FC<{ flow: Flow; requests: FlowRequest[] }> = ({ flow, requests }) => {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeEnvironment } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const initial = useMemo(() => toCanvas(flow.graph), [flow.graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string>(START_NODE_ID);
  const [steps, setSteps] = useState<Record<string, FlowStep | undefined>>({});
  // the run's steps as they end, each with its place in the run
  const [log, setLog] = useState<(FlowStep & { seq: number })[]>([]);
  const [result, setResult] = useState<FlowResult | null>(null);
  const [running, setRunning] = useState<AbortController | null>(null);
  const runningRef = useRef<AbortController | null>(null);
  const requestsById = useMemo(() => new Map(requests.map(request => [request._id, request])), [requests]);

  // saved a moment after each change, and before a run or leaving
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async () => {
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    const current = await models.flow.getById(flow._id);
    if (current) {
      await models.flow.update(current, { graph: fromCanvas(latest.current.nodes, latest.current.edges) });
    }
  }, [flow._id]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pending.current) {
      clearTimeout(pending.current);
    }
    pending.current = setTimeout(save, 400);
  }, [nodes, edges, save]);
  useEffect(() => () => {
    if (pending.current) {
      save();
    }
    runningRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- on leaving only
  }, []);

  const selected = nodes.find(node => node.id === selectedId) || nodes.find(node => node.id === START_NODE_ID);

  const onConnect = useCallback((connection: Connection) => setEdges(current => addEdge(
    edgeOnCanvas({ id: generateId('fle'), source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle }),
    // one arrow out of each way: a new one replaces the old
    current.filter(edge => !(edge.source === connection.source && (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null))),
  )), [setEdges]);

  // a step after the selected one, joined to it by its free way out (a condition's Yes, then its No)
  const addStep = (kind: Exclude<FlowNodeKind, 'start'>) => {
    const after = selected;
    const id = generateId('fln');
    const outs = after ? edges.filter(edge => edge.source === after.id) : [];
    const handle = after?.type === 'condition'
      ? (['true', 'false'] as const).find(branch => !outs.some(edge => edge.sourceHandle === branch))
      : outs.length ? undefined : null;
    const branchOffset = handle === 'false' ? 110 : 0;
    const position = after ? { x: after.position.x + 260, y: after.position.y + branchOffset } : { x: 0, y: 0 };
    const data: FlowNodeData = kind === 'condition'
      ? { source: 'status', operator: 'equals', value: '200' }
      : kind === 'delay' ? { milliseconds: 1000 } : kind === 'setVariable' ? { source: 'value' } : {};
    setNodes(current => [...current.map(node => ({ ...node, selected: false })), { id, type: kind, position, data, deletable: true, selected: true }]);
    if (after && handle !== undefined) {
      setEdges(current => [...current, edgeOnCanvas({ id: generateId('fle'), source: after.id, target: id, sourceHandle: handle })]);
    }
    setSelectedId(id);
  };

  const changeSelected = (patch: Partial<FlowNodeData>) => setNodes(current => current.map(node => (node.id === selected?.id ? { ...node, data: { ...node.data, ...patch } } : node)));
  const deleteSelected = () => {
    if (!selected || selected.id === START_NODE_ID) {
      return;
    }
    setNodes(current => current.filter(node => node.id !== selected.id));
    setEdges(current => current.filter(edge => edge.source !== selected.id && edge.target !== selected.id));
    setSelectedId(START_NODE_ID);
  };

  const run = async () => {
    await save();
    const controller = new AbortController();
    runningRef.current = controller;
    setRunning(controller);
    setSteps({});
    setLog([]);
    setResult(null);
    const outcome = await runFlow(fromCanvas(latest.current.nodes, latest.current.edges), appFlowRunner({ workspaceId, environmentId: activeEnvironment?._id }), {
      signal: controller.signal,
      onStep: step => {
        setSteps(current => ({ ...current, [step.nodeId]: step }));
        if (step.status !== 'running') {
          setLog(current => [...current, { ...step, seq: current.length }]);
        }
      },
    });
    setResult(outcome);
    runningRef.current = null;
    setRunning(null);
  };

  const nameOf = (nodeId: string) => {
    const node = nodes.find(candidate => candidate.id === nodeId);
    if (node?.type === 'request' && node.data.requestId) {
      return requestsById.get(node.data.requestId)?.name || KIND_NAMES.request();
    }
    return node ? KIND_NAMES[node.type]() : nodeId;
  };

  return (
    <CanvasContext.Provider value={{ requests: requestsById, steps }}>
      <div className="flex h-full w-full overflow-hidden">
        <div className="flex flex-col flex-1 min-w-0">
          <div role="toolbar" aria-label={t('Flow')} className="flex flex-wrap items-center gap-[--padding-sm] px-[--padding-sm] py-[--padding-xs] border-b border-solid border-[--hl-md]">
            {running ? (
              <button className="btn btn--clicky btn--compact" onClick={() => running.abort()}>
                <i className="fa fa-stop space-right" />{t('Stop')}
              </button>
            ) : (
              <button className="btn btn--clicky btn--compact" onClick={run}>
                <i className="fa fa-play space-right" />{t('Run Flow')}
              </button>
            )}
            <span className="text-[--hl] text-[--font-size-sm]">{t('Add after the selected step:')}</span>
            {ADDABLE.map(kind => (
              <button key={kind} className="btn btn--clicky btn--compact" disabled={!!running} onClick={() => addStep(kind)}>
                <i className="fa fa-plus space-right" />{KIND_NAMES[kind]()}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 insomnium-flow">
            <ReactFlow<CanvasNode, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={connection => connection.source !== connection.target}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
              onNodesDelete={deleted => deleted.some(node => node.id === selectedId) && setSelectedId(START_NODE_ID)}
              deleteKeyCode={['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </div>
        <aside className="w-[22rem] max-w-[45%] flex-shrink-0 overflow-y-auto border-l border-solid border-[--hl-md] pad flex flex-col gap-[--padding-lg]">
          {selected && <Inspector key={selected.id} node={selected} requests={requests} onChange={changeSelected} onDelete={deleteSelected} />}
          <section aria-label={t('Run')} className="flex flex-col gap-[--padding-xs]">
            <h3 className="m-0 text-[--font-size-md]">{t('Last Run')}</h3>
            {!log.length && !running && !result && <p className="m-0 faint text-[--font-size-sm]">{t('Run the flow to see each step here.')}</p>}
            <ol className="list-none m-0 p-0 flex flex-col gap-[--padding-xxs]">
              {log.map(step => (
                <li key={step.seq}>
                  <button className="w-full text-left flex items-start gap-[--padding-xs] text-[--font-size-sm] hover:bg-[--hl-xs] rounded-sm px-[--padding-xxs]" onClick={() => setSelectedId(step.nodeId)}>
                    <i className={`fa fa-fw mt-[2px] ${STEP_ICONS[step.status]}`} />
                    <span className="min-w-0">
                      <span className="font-semibold">{nameOf(step.nodeId)}</span>
                      {step.message && <span className="block break-words text-[--hl]">{step.message}</span>}
                      {step.response && (
                        <span className="block text-[--hl]">{t('{milliseconds} ms, {bytes} bytes', { milliseconds: Math.round(step.response.elapsedTime || 0), bytes: step.response.size })}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {result && (
              <p role="status" className={classnames('m-0 font-semibold', result.passed ? 'text-[--color-success]' : 'text-[--color-danger]')}>
                {result.message}
              </p>
            )}
            {result && Object.keys(result.variables).length > 0 && (
              <table className="table--fancy table--compact text-[--font-size-sm]">
                <caption className="text-left text-[--hl]">{t('Variables')}</caption>
                <tbody>
                  {Object.entries(result.variables).map(([name, value]) => (
                    <tr key={name}>
                      <td className="font-mono">{name}</td>
                      <td className="font-mono break-all">{value.length > 200 ? `${value.slice(0, 200)}…` : value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      </div>
    </CanvasContext.Provider>
  );
};

export const FlowEditor: FC<{ flow: Flow; requests: FlowRequest[] }> = props => (
  <ReactFlowProvider>
    <Editor {...props} />
  </ReactFlowProvider>
);
