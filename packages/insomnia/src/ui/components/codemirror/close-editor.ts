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
  codeMirror.toTextArea();
  codeMirror.closeHintDropdown();
}
