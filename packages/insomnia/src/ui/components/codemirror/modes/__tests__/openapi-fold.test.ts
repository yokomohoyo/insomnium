import 'codemirror/addon/fold/indent-fold';
import '../openapi';

import { describe, expect, it, jest } from '@jest/globals';
import CodeMirror from 'codemirror';

// what CodeMirror measures text with, which jsdom hasn't got
const rect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
Range.prototype.getBoundingClientRect = rect as unknown as Range['getBoundingClientRect'];
Range.prototype.getClientRects = (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as unknown as Range['getClientRects'];

const yaml = `openapi: 3.0.0
# a comment
info:
  title: Pets
    # an indented comment

  version: 1.0.0
paths:
  /pets:
    get:
      summary: List
      responses:
        '200':
          description: OK
  # between paths
  /pets/{id}:
    get:
      summary: "One # not a comment"
x-end: true
`;

const json = JSON.stringify({ openapi: '3.0.0', info: { title: 'Pets', version: '1' }, paths: { '/pets': { get: { responses: { 200: { description: 'OK' } } } } } }, null, 2);

describe("the openapi mode's indent folding", () => {
  for (const [name, text] of [['YAML', yaml], ['JSON', json]]) {
    it(`folds ${name} as the indent helper does, without the line's tokens`, () => {
      const editor = CodeMirror(document.body, { value: text, mode: 'openapi' });
      const tokens = jest.spyOn(editor, 'getTokenTypeAt');
      const ours = CodeMirror.fold['openapi-indent'];
      const ranges = [];
      for (let line = 0; line < editor.lineCount(); line++) {
        ranges.push(ours(editor, CodeMirror.Pos(line, 0)));
      }
      expect(tokens).not.toHaveBeenCalled();

      for (let line = 0; line < editor.lineCount(); line++) {
        expect([line, ranges[line]]).toEqual([line, CodeMirror.fold.indent(editor, CodeMirror.Pos(line, 0))]);
      }
      // it is the one the mode folds with
      expect(editor.getHelpers(CodeMirror.Pos(0, 0), 'fold')).toContain(ours);
    });
  }
});
