import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import { ResponseMultipartViewer } from '../response-multipart-viewer';

jest.mock('../../modals/index', () => ({
  showError: jest.fn(),
  showModal: jest.fn(),
}));
jest.mock('../../modals/wrapper-modal', () => ({ WrapperModal: () => null }));
jest.mock('../response-viewer', () => ({ ResponseViewer: () => null }));
jest.mock('../response-headers-viewer', () => ({ ResponseHeadersViewer: () => null }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { showError } = require('../../modals/index');

describe('<ResponseMultipartViewer /> Save as File', () => {
  const boundary = 'part-boundary';
  const bodyBuffer = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="part.txt"',
    'Content-Type: text/plain',
    '',
    'part body',
    `--${boundary}--`,
    '',
  ].join('\r\n'));
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-part-'));
    window.app = { getPath: () => tmpDir } as unknown as Window['app'];
    window.localStorage.clear();
    showError.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const saveTo = async (filePath: string) => {
    window.dialog = { showSaveDialog: jest.fn(async () => ({ canceled: false, filePath })) } as unknown as Window['dialog'];
    const { findAllByRole, findByText } = render(
      <ResponseMultipartViewer
        download={jest.fn()}
        responseId="res_1"
        bodyBuffer={bodyBuffer}
        contentType={`multipart/form-data; boundary=${boundary}`}
        disableHtmlPreviewJs
        disablePreviewLinks
        filter=""
        filterHistory={[]}
        editorFontSize={12}
        url="http://localhost"
      />,
    );
    // The second button opens the part actions
    fireEvent.click((await findAllByRole('button'))[1]);
    fireEvent.click(await findByText('Save as File'));
  };

  it('saves the part and remembers the folder it was saved to', async () => {
    const folder = path.join(tmpDir, 'parts');
    fs.mkdirSync(folder);
    const target = path.join(folder, 'saved.txt');

    await saveTo(target);

    await waitFor(() => expect(fs.existsSync(target) && fs.readFileSync(target, 'utf8')).toBe('part body'));
    expect(window.localStorage.getItem('insomnia.lastExportPath')).toBe(folder);
    expect(showError).not.toHaveBeenCalled();
  });

  it('reports the failure when the file cannot be written', async () => {
    const target = path.join(tmpDir, 'missing', 'saved.txt');

    await saveTo(target);

    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    const { message } = showError.mock.calls[0][0];
    expect(message).toContain(`Failed to save to ${target}: `);
    expect(message).toContain('ENOENT');
  });
});
