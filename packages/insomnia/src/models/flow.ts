import { database as db } from '../common/database';
import type { FlowGraph } from '../flows/run-flow';
import type { BaseModel } from './index';

// A flow (flows/run-flow.ts): a collection's requests on a canvas, joined by
// arrows, with conditions, variables and delays between them

export const name = 'Flow';

export const type = 'Flow';

export const prefix = 'flw';

export const canDuplicate = true;

export const canSync = true;

export interface BaseFlow {
  name: string;
  description: string;
  graph: FlowGraph;
}

export type Flow = BaseModel & BaseFlow;

export const isFlow = (model: Pick<BaseModel, 'type'>): model is Flow => model.type === type;

// a new flow has its Start, where it begins
export const START_NODE_ID = 'start';

export function init(): BaseFlow {
  return {
    name: 'New Flow',
    description: '',
    graph: {
      nodes: [{ id: START_NODE_ID, kind: 'start', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    },
  };
}

export function migrate(doc: Flow) {
  return doc;
}

export function create(patch: Partial<Flow> = {}) {
  if (!patch.parentId) {
    throw new Error('New Flow missing `parentId` ' + JSON.stringify(patch));
  }
  return db.docCreate<Flow>(type, patch);
}

export function update(flow: Flow, patch: Partial<Flow> = {}) {
  return db.docUpdate<Flow>(flow, patch);
}

export function remove(flow: Flow) {
  return db.remove(flow);
}

export function findByParentId(parentId: string) {
  return db.find<Flow>(type, { parentId });
}

export const getById = (_id: string) => db.getWhere<Flow>(type, { _id });

export function all() {
  return db.all<Flow>(type);
}

// the graph with each request it sends given by its id in `ids`, for a flow
// copied (imported, or its workspace duplicated) along with its requests
export const remapRequests = (graph: FlowGraph, ids: (id: string) => string | undefined): FlowGraph => ({
  ...graph,
  nodes: graph.nodes.map(node => (node.data.requestId && ids(node.data.requestId)
    ? { ...node, data: { ...node.data, requestId: ids(node.data.requestId) } }
    : node)),
});

export const remapIds = (doc: Flow, ids: (id: string) => string | undefined): Partial<Flow> | undefined =>
  doc.graph?.nodes.some(node => node.data.requestId && ids(node.data.requestId))
    ? { graph: remapRequests(doc.graph, ids) }
    : undefined;
