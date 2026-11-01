import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import React from 'react';

import { ResponseViewer, type ResponseViewerProps } from '../response-viewer';

const editors: { mode?: string; defaultValue?: string }[] = [];
jest.mock('../../codemirror/code-editor', () => ({
  CodeEditor: (props: { mode?: string; defaultValue?: string }) => {
    editors.push(props);
    return null;
  },
}));
jest.mock('../../keydown-binder', () => ({ useDocBodyKeyboardShortcuts: () => {} }));
jest.mock('../response-error-viewer', () => ({ ResponseErrorViewer: ({ error }: { error: string }) => <p>{error}</p> }));

const props = (getBody: () => Buffer, contentType = 'text/plain'): ResponseViewerProps => ({
  bytes: 100,
  contentType,
  disableHtmlPreviewJs: true,
  disablePreviewLinks: false,
  download: () => {},
  editorFontSize: 12,
  filter: '',
  filterHistory: [],
  getBody,
  previewMode: 'friendly',
  responseId: 'res_1',
  url: 'http://localhost',
});

describe('<ResponseViewer />', () => {
  it('reads the body once, however often it renders', () => {
    const getBody = jest.fn(() => Buffer.from('{"caf\\u00e9": "☃"}'));
    const { rerender } = render(<ResponseViewer {...props(getBody)} />);
    for (let i = 0; i < 3; i++) {
      rerender(<ResponseViewer {...props(getBody)} filterHistory={[]} />);
    }

    expect(getBody).toHaveBeenCalledTimes(1);
    // still told to be JSON (whatever the header said), and decoded
    expect(editors.at(-1)).toMatchObject({ mode: 'application/json', defaultValue: '{"caf\\u00e9": "☃"}' });
  });

  it("decodes in the header's charset", () => {
    const getBody = () => Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    render(<ResponseViewer {...props(getBody, 'text/plain; charset=ISO-8859-1')} />);

    expect(editors.at(-1)).toMatchObject({ mode: 'text/plain; charset=iso-8859-1', defaultValue: 'café' });
  });

  it('says when the body could not be read', () => {
    const unreadable = () => {
      throw new Error('gone');
    };
    const { getByText } = render(<ResponseViewer {...props(unreadable)} />);

    expect(getByText(/Failed reading response from filesystem/)).toBeTruthy();
  });
});
