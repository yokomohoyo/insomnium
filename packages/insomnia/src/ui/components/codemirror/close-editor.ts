import type CodeMirror from 'codemirror';

/**
 * Takes down an editor so nothing keeps it: its hint dropdown, and the window
 * scroll listener of the selection-pointer addon, which is removed only when
 * the option is turned off (toTextArea doesn't). Kept, it held every editor
 * a window ever had, with its text, for as long as the window lived.
 */
export function closeEditor(codeMirror: CodeMirror.EditorFromTextArea | null) {
  if (!codeMirror) {
    return;
  }
  codeMirror.setOption('selectionPointer', false);
  // Turning it off empties the addon's state, but an update it already
  // scheduled (50ms after the last mouse move or scroll) still sets
  // state.selectionPointer.willUpdate, and threw on the empty state. An inert
  // one takes that write; nothing listens for it any more.
  codeMirror.state.selectionPointer = { rects: null, mouseX: null, mouseY: null, willUpdate: false };
  codeMirror.toTextArea();
  codeMirror.closeHintDropdown();
}
