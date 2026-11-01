import 'codemirror/addon/selection/selection-pointer';

import { describe, expect, it, jest } from '@jest/globals';
import CodeMirror from 'codemirror';

import { closeEditor } from '../close-editor';

// (the app's own, from its hint extension)
CodeMirror.defineExtension('closeHintDropdown', () => {});
// what CodeMirror measures text with, which jsdom hasn't got
const rect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
Range.prototype.getBoundingClientRect = rect as unknown as Range['getBoundingClientRect'];
Range.prototype.getClientRects = (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as unknown as Range['getClientRects'];

describe('closeEditor()', () => {
  it('leaves nothing on the window that would keep the editor', () => {
    const added = jest.spyOn(window, 'addEventListener');
    const removed = jest.spyOn(window, 'removeEventListener');
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const editor = CodeMirror.fromTextArea(textarea, { selectionPointer: 'default' } as CodeMirror.EditorConfiguration);
    const scrollListeners = added.mock.calls.filter(([type]) => type === 'scroll').map(([, listener]) => listener);
    expect(scrollListeners).toHaveLength(1);

    closeEditor(editor);

    expect(removed.mock.calls.filter(([type]) => type === 'scroll').map(([, listener]) => listener)).toEqual(scrollListeners);
  });

  it('does nothing without an editor', () => {
    expect(() => closeEditor(null)).not.toThrow();
  });
});
