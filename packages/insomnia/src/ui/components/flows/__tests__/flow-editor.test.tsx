import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import type { FlowGraph } from '../../../../flows/run-flow';
import * as models from '../../../../models';
import { FlowEditor } from '../flow-editor';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<object>('react-router-dom'),
  useParams: jest.fn(),
  useRouteLoaderData: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useParams, useRouteLoaderData } = require('react-router-dom');

const start = { id: 'start', kind: 'start' as const, position: { x: 0, y: 0 }, data: {} };

describe('FlowEditor', () => {
  beforeAll(() => {
    // the canvas measures its nodes, which jsdom can't
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  beforeEach(globalBeforeEach);

  it('shows a change made elsewhere (over MCP, or by a Git pull), and keeps it', async () => {
    const workspace = await models.workspace.create({ name: 'Pets' });
    useParams.mockReturnValue({ workspaceId: workspace._id });
    useRouteLoaderData.mockReturnValue({ activeEnvironment: null });
    const flow = await models.flow.create({ parentId: workspace._id });
    const { rerender } = render(<FlowEditor flow={flow} requests={[]} />);
    expect(screen.getAllByTestId(/^flow-node-/)).toHaveLength(1);

    // the route's loader gives the editor the flow as it is now
    const graph: FlowGraph = {
      nodes: [start, { id: 'wait', kind: 'delay', position: { x: 260, y: 0 }, data: { milliseconds: 5 } }],
      edges: [{ id: 'e1', source: 'start', target: 'wait' }],
    };
    const changed = await models.flow.update(flow, { graph });
    rerender(<FlowEditor flow={changed} requests={[]} />);
    await waitFor(() => expect(screen.getAllByTestId('flow-node-delay')).toHaveLength(1));

    // and the editor's save, a moment after, doesn't put back the graph it had
    await new Promise(resolve => setTimeout(resolve, 600));
    expect((await models.flow.getById(flow._id))?.graph).toEqual(graph);
  });
});
