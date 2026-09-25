import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import type { WebSocketMessageEvent } from '../../../../main/network/websocket';
import { MessageEventView } from '../event-view';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<object>('react-router-dom'),
  useParams: () => ({ requestId: 'req_1' }),
  useRouteLoaderData: () => ({ activeRequestMeta: {} }),
}));
jest.mock('../../../../models', () => ({ requestMeta: {} }));
jest.mock('../../codemirror/code-editor', () => ({ CodeEditor: () => null }));
jest.mock('../../modals', () => ({
  showError: jest.fn(),
}));
jest.mock('../websocket-preview-dropdown', () => ({
  WebSocketPreviewModeDropdown: ({ download }: { download: () => void }) => (
    <button onClick={download}>Save message</button>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { showError } = require('../../modals');

describe('<MessageEventView /> Save Response Body', () => {
  const event = { _id: 'ws-message_1', type: 'message', data: '{"a":1}' } as unknown as WebSocketMessageEvent;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-message-'));
    showError.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const saveTo = (filePath: string) => {
    window.dialog = { showSaveDialog: jest.fn(async () => ({ canceled: false, filePath })) } as unknown as Window['dialog'];
    const { getByText } = render(<MessageEventView event={event} />);
    fireEvent.click(getByText('Save message'));
  };

  it('saves the message', async () => {
    const target = path.join(tmpDir, 'message.json');

    saveTo(target);

    await waitFor(() => expect(fs.existsSync(target) && fs.readFileSync(target, 'utf8')).toBe('{"a":1}'));
    expect(showError).not.toHaveBeenCalled();
  });

  it('reports the failure when the file cannot be written', async () => {
    const target = path.join(tmpDir, 'missing', 'message.json');

    saveTo(target);

    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    const { message } = showError.mock.calls[0][0];
    expect(message).toContain(`Failed to save to ${target}: `);
    expect(message).toContain('ENOENT');
  });
});
