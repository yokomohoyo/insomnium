import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import { ResponsePane } from '../response-pane';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<object>('react-router-dom'),
  useRouteLoaderData: jest.fn(),
}));
jest.mock('../../../hooks/use-request', () => ({
  useRequestMetaPatcher: () => jest.fn(),
}));
jest.mock('../../modals', () => ({
  showError: jest.fn(),
}));
jest.mock('../../dropdowns/preview-mode-dropdown', () => ({
  PreviewModeDropdown: ({ download }: { download: (pretty: boolean) => void }) => (
    <>
      <button onClick={() => download(false)}>Export raw response</button>
      <button onClick={() => download(true)}>Export prettified response</button>
    </>
  ),
}));
jest.mock('../../dropdowns/response-history-dropdown', () => ({ ResponseHistoryDropdown: () => null }));
jest.mock('../../viewers/response-viewer', () => ({ ResponseViewer: () => null }));
jest.mock('../../viewers/response-headers-viewer', () => ({ ResponseHeadersViewer: () => null }));
jest.mock('../../viewers/response-cookies-viewer', () => ({ ResponseCookiesViewer: () => null }));
jest.mock('../../viewers/response-timeline-viewer', () => ({ ResponseTimelineViewer: () => null }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useRouteLoaderData } = require('react-router-dom');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { showError } = require('../../modals');

describe('<ResponsePane /> Save Response Body', () => {
  let tmpDir: string;
  let bodyPath: string;
  let activeResponse: Record<string, unknown>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-body-'));
    bodyPath = path.join(tmpDir, 'body.zip');
    fs.writeFileSync(bodyPath, zlib.gzipSync('{"a":1}'));

    activeResponse = {
      _id: 'res_1',
      type: 'Response',
      parentId: 'req_1',
      contentType: 'application/json',
      headers: [],
      bodyPath,
      bodyCompression: 'zip',
      timelinePath: '',
      statusCode: 200,
      statusMessage: 'OK',
      elapsedTime: 1,
      bytesRead: 7,
      bytesContent: 7,
      error: '',
      url: 'http://localhost',
    };
    useRouteLoaderData.mockImplementation((id: string) => id === 'root'
      ? { settings: { editorFontSize: 12 } }
      : {
        activeRequest: { _id: 'req_1', type: 'Request', name: 'My Request' },
        activeRequestMeta: {},
        activeResponse,
      });
    showError.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const saveTo = async (label: string, filePath: string) => {
    window.dialog = { showSaveDialog: jest.fn(async () => ({ canceled: false, filePath })) } as unknown as Window['dialog'];
    const { getByText } = render(<ResponsePane runningRequests={{}} />);
    fireEvent.click(getByText(label));
  };

  const expectSaveFailure = async (target: string, reason: string) => {
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    const { message } = showError.mock.calls[0][0];
    expect(message).toContain(`Failed to save to ${target}: `);
    expect(message).toContain(reason);
  };

  it('saves the raw body', async () => {
    const target = path.join(tmpDir, 'body.json');

    await saveTo('Export raw response', target);

    await waitFor(() => expect(fs.existsSync(target) && fs.readFileSync(target, 'utf8')).toBe('{"a":1}'));
    expect(showError).not.toHaveBeenCalled();
  });

  it('saves the prettified body', async () => {
    const target = path.join(tmpDir, 'body.json');

    await saveTo('Export prettified response', target);

    await waitFor(() => expect(fs.existsSync(target) && fs.readFileSync(target, 'utf8')).toBe('{\n\t"a": 1\n}'));
    expect(showError).not.toHaveBeenCalled();
  });

  const exports = ['Export raw response', 'Export prettified response'];

  it.each(exports)('%s reports the failure when the body cannot be read', async label => {
    const target = path.join(tmpDir, 'body.json');
    // Reading a folder fails with EISDIR after it was opened
    fs.rmSync(bodyPath);
    fs.mkdirSync(bodyPath);

    await saveTo(label, target);

    await expectSaveFailure(target, 'EISDIR');
  });

  it.each(exports)('%s reports the failure when the body is missing', async label => {
    const target = path.join(tmpDir, 'body.json');
    fs.rmSync(bodyPath);

    await saveTo(label, target);

    await expectSaveFailure(target, 'the response body could not be read');
    expect(fs.existsSync(target)).toBe(false);
  });

  it.each(exports)('%s reports the failure when the response has no body', async label => {
    const target = path.join(tmpDir, 'body.json');
    activeResponse.bodyPath = '';

    await saveTo(label, target);

    await expectSaveFailure(target, 'the response body could not be read');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('reports the failure when the file cannot be written', async () => {
    const target = path.join(tmpDir, 'missing', 'body.json');

    await saveTo('Export prettified response', target);

    await expectSaveFailure(target, 'ENOENT');
  });
});
