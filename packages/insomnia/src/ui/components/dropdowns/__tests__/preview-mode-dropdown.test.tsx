import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import { PreviewModeDropdown } from '../preview-mode-dropdown';

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
jest.mock('../../../../common/har', () => ({
  exportHarCurrentRequest: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useRouteLoaderData } = require('react-router-dom');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { showError } = require('../../modals');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { exportHarCurrentRequest } = require('../../../../common/har');

describe('<PreviewModeDropdown /> exports', () => {
  let tmpDir: string;
  let bodyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-debug-'));
    bodyPath = path.join(tmpDir, 'body.zip');
    fs.writeFileSync(bodyPath, zlib.gzipSync('response body'));
    const timelinePath = path.join(tmpDir, 'timeline.json');
    fs.writeFileSync(timelinePath, JSON.stringify([{ name: 'HeaderIn', timestamp: 0, value: 'HTTP/1.1 200 OK\r\n\r\n' }]));

    useRouteLoaderData.mockReturnValue({
      activeRequest: { _id: 'req_1', type: 'Request', name: 'My Request' },
      activeRequestMeta: {},
      activeResponse: { _id: 'res_1', type: 'Response', contentType: 'text/plain', bodyPath, bodyCompression: 'zip', timelinePath },
    });
    showError.mockClear();
    exportHarCurrentRequest.mockReset();
    exportHarCurrentRequest.mockResolvedValue({ log: {} });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const exportTo = async (item: string, filePath: string) => {
    window.dialog = { showSaveDialog: jest.fn(async () => ({ canceled: false, filePath })) } as unknown as Window['dialog'];
    const { getByRole, findByText } = render(<PreviewModeDropdown download={jest.fn()} copyToClipboard={jest.fn()} />);
    fireEvent.click(getByRole('button'));
    fireEvent.click(await findByText(item));
  };
  const exportDebugTo = (filePath: string) => exportTo('Export HTTP debug', filePath);

  const expectSaveFailure = async (target: string, reason: string) => {
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    const { message } = showError.mock.calls[0][0];
    expect(message).toContain(`Failed to save to ${target}: `);
    expect(message).toContain(reason);
  };

  it('saves the HAR file', async () => {
    const target = path.join(tmpDir, 'export.har');

    await exportTo('Export as HAR', target);

    await waitFor(() => expect(fs.existsSync(target) && fs.readFileSync(target, 'utf8')).toBe('{\n\t"log": {}\n}'));
    expect(showError).not.toHaveBeenCalled();
  });

  it('reports the failure when the HAR file cannot be saved', async () => {
    const target = path.join(tmpDir, 'missing', 'export.har');

    await exportTo('Export as HAR', target);

    await expectSaveFailure(target, 'ENOENT');
  });

  it('reports the failure when the HAR cannot be built', async () => {
    exportHarCurrentRequest.mockRejectedValue(new Error('Failed to render "My Request:url"'));

    await exportTo('Export as HAR', path.join(tmpDir, 'export.har'));

    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    expect(showError.mock.calls[0][0].message).toBe('Failed to export as HAR: Failed to render "My Request:url"');
    expect(window.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it('saves the headers followed by the body', async () => {
    const target = path.join(tmpDir, 'debug.txt');

    await exportDebugTo(target);

    await waitFor(() => expect(fs.existsSync(target) && fs.readFileSync(target, 'utf8')).toBe('HTTP/1.1 200 OK\r\n\r\nresponse body'));
    expect(showError).not.toHaveBeenCalled();
  });

  it('reports the failure when the folder does not exist', async () => {
    const target = path.join(tmpDir, 'missing', 'debug.txt');

    await exportDebugTo(target);

    await expectSaveFailure(target, 'ENOENT');
  });

  it('reports the failure when the body cannot be read', async () => {
    const target = path.join(tmpDir, 'debug.txt');
    // Reading a folder fails with EISDIR after it was opened
    fs.rmSync(bodyPath);
    fs.mkdirSync(bodyPath);

    await exportDebugTo(target);

    await expectSaveFailure(target, 'EISDIR');
  });
});
