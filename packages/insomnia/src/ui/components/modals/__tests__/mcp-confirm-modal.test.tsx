import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react';
import React from 'react';

import type { InAppQuestion } from '../../../../main/mcp/ask-in-app';
import { McpConfirmModal } from '../mcp-confirm-modal';

// the main process, as the page hears it and answers it
const listeners: Record<string, (event: unknown, ...args: any[]) => void> = {};
const mcpConfirmShown = jest.fn();
const answerMcpConfirm = jest.fn();
(window as any).main = {
  on: (channel: string, listener: (event: unknown, ...args: any[]) => void) => {
    listeners[channel] = listener;
    return () => delete listeners[channel];
  },
  mcpConfirmShown,
  answerMcpConfirm,
};

const question = (patch: Partial<InAppQuestion> = {}): InAppQuestion => ({
  id: 'q1',
  type: 'warning',
  title: 'Run security tests?',
  message: 'An MCP client wants to run the security tests on "Orders" (Shop).',
  detail: 'GET https://shop.example.com/orders\n\nThe request is sent again up to 25 times.',
  yes: 'Run the Tests',
  no: "Don't Run",
  ...patch,
});
const ask = (asked: InAppQuestion) => act(() => listeners['mcp.confirm']({}, asked));

describe('<McpConfirmModal />', () => {
  beforeEach(() => {
    mcpConfirmShown.mockReset();
    answerMcpConfirm.mockReset();
  });

  it('shows nothing until it is asked something', () => {
    const { queryByRole } = render(<McpConfirmModal />);

    expect(queryByRole('dialog')).toBeNull();
    expect(mcpConfirmShown).not.toHaveBeenCalled();
  });

  it('shows the question, says it has, and has the no as the default', () => {
    const { getByRole, getByTestId } = render(<McpConfirmModal />);

    ask(question());

    const dialog = getByRole('dialog');
    expect(dialog.textContent).toContain('Run security tests?');
    expect(dialog.textContent).toContain('An MCP client wants to run the security tests on "Orders" (Shop).');
    expect(getByTestId('mcp-confirm-detail').textContent).toBe('GET https://shop.example.com/orders\n\nThe request is sent again up to 25 times.');
    expect(mcpConfirmShown).toHaveBeenCalledWith('q1');
    expect(document.activeElement).toBe(getByRole('button', { name: "Don't Run" }));
    expect(answerMcpConfirm).not.toHaveBeenCalled();
  });

  it('answers yes only from its yes button', () => {
    const { getByRole, queryByRole } = render(<McpConfirmModal />);
    ask(question());

    fireEvent.click(getByRole('button', { name: 'Run the Tests' }));

    expect(answerMcpConfirm.mock.calls).toEqual([['q1', true]]);
    expect(queryByRole('dialog')).toBeNull();
  });

  it('answers no from its no button', () => {
    const { getByRole } = render(<McpConfirmModal />);
    ask(question());

    fireEvent.click(getByRole('button', { name: "Don't Run" }));

    expect(answerMcpConfirm.mock.calls).toEqual([['q1', false]]);
  });

  it('answers no when it is closed any other way', () => {
    const { getByRole, queryByRole } = render(<McpConfirmModal />);
    ask(question());

    fireEvent.click(getByRole('button', { name: 'Close dialog' }));

    expect(answerMcpConfirm.mock.calls).toEqual([['q1', false]]);
    expect(queryByRole('dialog')).toBeNull();
  });

  it('closes without an answer when the client gives up on its request', () => {
    const { queryByRole } = render(<McpConfirmModal />);
    ask(question());

    act(() => listeners['mcp.confirm.cancel']({}, 'q1'));

    expect(queryByRole('dialog')).toBeNull();
    expect(answerMcpConfirm).not.toHaveBeenCalled();
  });

  it('asks one at a time, in the order asked', () => {
    const { getByRole } = render(<McpConfirmModal />);
    ask(question());
    ask(question({ id: 'q2', title: 'Push with Git?', yes: 'Push', no: 'Cancel' }));

    expect(getByRole('dialog').textContent).toContain('Run security tests?');
    expect(mcpConfirmShown.mock.calls).toEqual([['q1']]);
    fireEvent.click(getByRole('button', { name: "Don't Run" }));

    expect(getByRole('dialog').textContent).toContain('Push with Git?');
    expect(mcpConfirmShown.mock.calls).toEqual([['q1'], ['q2']]);
    fireEvent.click(getByRole('button', { name: 'Push' }));
    expect(answerMcpConfirm.mock.calls).toEqual([['q1', false], ['q2', true]]);
  });
});
