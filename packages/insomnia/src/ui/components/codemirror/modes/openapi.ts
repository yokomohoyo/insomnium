import CodeMirror from 'codemirror';
CodeMirror.defineMode('openapi', function() {
  const cons = ['true', 'false', 'on', 'off', 'yes', 'no'];
  const keywordRegex = new RegExp('\\b((' + cons.join(')|(') + '))$', 'i');
  return {
    token: function(stream, state) {
      const ch = stream.peek();
      const esc = state.escaped;
      state.escaped = false;

      /* comments */
      if (ch === '#' && (stream.pos === 0 || /\s/.test(stream.string.charAt(stream.pos - 1)))) {
        stream.skipToEnd();
        return 'comment';
      }

      if (stream.match(/^('([^']|\\.)*'?|"([^"]|\\.)*"?)/)) {
        return 'string';
      }

      if (state.literal && stream.indentation() > state.keyCol) {
        stream.skipToEnd();
        return 'string';
      } else if (state.literal) {
        state.literal = false;
      }

      if (stream.sol()) {
        state.keyCol = 0;
        state.pair = false;
        state.pairStart = false;

        /* document start */
        if (stream.match(/---/)) {
          return 'def';
        }

        /* document end */
        if (stream.match(/\.\.\./)) {
          return 'def';
        }

        /* array list item */
        if (stream.match(/\s*-\s+/)) {
          return 'meta';
        }
      }

      /* inline pairs/lists */
      if (stream.match(/^(\{|\}|\[|\])/)) {
        if (ch === '{') {
          state.inlinePairs++;
        } else if (ch === '}') {
          state.inlinePairs--;
        } else if (ch === '[') {
          state.inlineList++;
        } else {
          state.inlineList--;
        }

        return 'meta';
      }

      /* list separator */
      if (state.inlineList > 0 && !esc && ch === ',') {
        stream.next();
        return 'meta';
      }

      /* pairs separator */
      if (state.inlinePairs > 0 && !esc && ch === ',') {
        state.keyCol = 0;
        state.pair = false;
        state.pairStart = false;
        stream.next();
        return 'meta';
      }

      /* start of value of a pair */
      if (state.pairStart) {
        /* block literals */
        if (stream.match(/^\s*(\||>)\s*/)) {
          state.literal = true;
          return 'meta';
        }

        /* references */
        if (stream.match(/^\s*(&|\*)[a-z0-9._-]+\b/i)) {
          return 'variable-2';
        }

        /* numbers */
        if (state.inlinePairs === 0 && stream.match(/^\s*-?[0-9.,]+\s?$/)) {
          return 'number';
        }

        if (state.inlinePairs > 0 && stream.match(/^\s*-?[0-9.,]+\s?(?=(,|}))/)) {
          return 'number';
        }

        /* keywords */
        if (stream.match(keywordRegex)) {
          return 'keyword';
        }
      }

      /* pairs (associative arrays) -> key */
      if (
        !state.pair &&
        stream.match(/^\s*(?:[,[\]{}&*!|>'"%@`][^\s'":]|[^,[\]{}#&*!|>'"%@`])[^#]*?(?=\s*:($|\s))/)
      ) {
        state.pair = true;
        state.keyCol = stream.indentation();
        return 'atom';
      }

      if (state.pair && stream.match(/^:\s*/)) {
        state.pairStart = true;
        return 'meta';
      }

      /* nothing found, continue */
      state.pairStart = false;
      state.escaped = ch === '\\';
      stream.next();
      return null;
    },
    startState: function() {
      return {
        pair: false,
        pairStart: false,
        keyCol: 0,
        inlinePairs: 0,
        inlineList: 0,
        literal: false,
        escaped: false,
      };
    },
    lineComment: '#',
    fold: 'openapi-indent',
  };
});

// A line's indent, or -1 for a blank line or a comment
const lineIndent = (cm: CodeMirror.Editor, lineNo: number) => {
  const text = cm.getLine(lineNo);
  const spaceTo = text.search(/\S/);
  return spaceTo === -1 || text[spaceTo] === '#' ? -1 : CodeMirror.countColumn(text, null, cm.getOption('tabSize') ?? 4);
};

// Folds by indentation, as the addon's indent helper does, but tells a comment
// by its # as this mode does (one starting a line's text), rather than by the
// line's tokens: those parse the document from its start, so the fold gutter
// parsed all of a large spec for its first line, and again as it scrolled.
CodeMirror.registerHelper('fold', 'openapi-indent', (cm: CodeMirror.Editor, start: CodeMirror.Position) => {
  const myIndent = lineIndent(cm, start.line);
  if (myIndent < 0) {
    return undefined;
  }
  let lastLineInFold: number | null = null;
  for (let i = start.line + 1, end = cm.lastLine(); i <= end; ++i) {
    const indent = lineIndent(cm, i);
    if (indent === -1) {
      continue;
    } else if (indent > myIndent) {
      lastLineInFold = i;
    } else {
      break;
    }
  }
  return lastLineInFold === null ? undefined : {
    from: CodeMirror.Pos(start.line, cm.getLine(start.line).length),
    to: CodeMirror.Pos(lastLineInFold, cm.getLine(lastLineInFold).length),
  };
});
CodeMirror.defineMIME('text/x-openapi', 'openapi');
CodeMirror.defineMIME('text/openapi', 'openapi');
