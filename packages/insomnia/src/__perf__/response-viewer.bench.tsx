// npm run bench -- response-viewer
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import React from 'react';

import { ResponseViewer } from '../ui/components/viewers/response-viewer';
import { largeJson } from './fixtures';
import { median, report } from './seed';

// the editor's own cost isn't measured here
jest.mock('../ui/components/codemirror/code-editor', () => ({ CodeEditor: () => null }));
jest.mock('../ui/components/keydown-binder', () => ({ useDocBodyKeyboardShortcuts: () => {} }));

describe('response viewer, re-rendered (as when the request is edited)', () => {
  it('a 4 MB JSON body', async () => {
    const body = largeJson(4 * 1024 * 1024);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-bench-')), 'body.json');
    fs.writeFileSync(file, body);
    let reads = 0;
    const getBody = () => {
      reads++;
      return fs.readFileSync(file);
    };
    const props = { bytes: body.length, contentType: 'application/json', disableHtmlPreviewJs: true, disablePreviewLinks: false, download: () => {}, editorFontSize: 12, filter: '', previewMode: 'friendly', responseId: 'res_1', url: 'http://localhost', getBody };
    const { rerender } = render(<ResponseViewer {...props} filterHistory={[]} />);

    const ms = await median(() => rerender(<ResponseViewer {...props} filterHistory={[]} />), 10);
    report('re-render with a 4 MB JSON body', ms);
    console.log(`body reads in 12 renders: ${reads}`);
    expect(reads).toBe(1);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }, 120_000);
});
