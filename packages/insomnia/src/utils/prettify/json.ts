const STATE_IN_NUN_VAR = 'nunvar';
const STATE_IN_NUN_TAG = 'nuntag';
const STATE_IN_NUN_COM = 'nuncom';
const STATE_IN_STRING = 'string';
const STATE_NONE = 'none';

const NUNJUCKS_OPEN_STATES: {
  '{{': typeof STATE_IN_NUN_VAR;
  '{%': typeof STATE_IN_NUN_TAG;
  '{#': typeof STATE_IN_NUN_COM;
  [anythingElse: string]: string | undefined;
} = {
  '{{': STATE_IN_NUN_VAR,
  '{%': STATE_IN_NUN_TAG,
  '{#': STATE_IN_NUN_COM,
};

const NUNJUCKS_CLOSE_STATES: {
  '}}': typeof STATE_IN_NUN_VAR;
  '%}': typeof STATE_IN_NUN_TAG;
  '#}': typeof STATE_IN_NUN_COM;
  [anythingElse: string]: string | undefined;
} = {
  '}}': STATE_IN_NUN_VAR,
  '%}': STATE_IN_NUN_TAG,
  '#}': STATE_IN_NUN_COM,
};

// character codes
const QUOTE = 34;
const BACKSLASH = 92;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const COMMA = 44;
const COLON = 58;
const SPACE = 32;
const NEWLINE = 10;
const TAB = 9;
const RETURN = 13;
// what ends a run of other characters outside a string
const STRUCTURAL = new Set([QUOTE, OPEN_BRACE, CLOSE_BRACE, OPEN_BRACKET, CLOSE_BRACKET, COMMA, COLON, SPACE, NEWLINE, TAB, RETURN]);

/**
 * Format a JSON string without parsing it as JavaScript.
 *
 * Code taken from jsonlint (http://zaa.ch/jsonlint/)
 */
export const jsonPrettify = (json?: string, indentChars = '\t', replaceUnicode = true) => {
  if (!json) {
    return '';
  }

  // Convert the unicode. To correctly mimic JSON.stringify(JSON.parse(json), null, indentChars)
  // we need to convert all escaped unicode characters to proper unicode characters.
  if (replaceUnicode) {
    try {
      json = convertUnicode(json);
    } catch (err) {
      // Just in case (should never happen)
      console.warn('Prettify failed to handle unicode', err);
    }
  }

  const il = json.length;
  const tab = indentChars;
  const indents: string[] = [];
  // (a negative level, from unbalanced input, as repeatString gave it)
  const indent = (level: number) => level < 0 ? repeatString(tab, level) : (indents[level] ??= tab.repeat(level));
  let newJson = '';
  let indentLevel = 0;
  let state = STATE_NONE;

  // Runs (a string's contents, a number, true) are copied whole: a character
  // at a time, a multi-MB body took ten times as long.
  let i = 0;
  while (i < il) {
    const code = json.charCodeAt(i);

    if (state === STATE_IN_STRING) {
      // up to the closing quote, an escape taking the character after it along
      let end = i;
      while (end < il) {
        const c = json.charCodeAt(end);
        if (c === QUOTE) {
          break;
        }
        end += c === BACKSLASH ? 2 : 1;
      }
      newJson += json.slice(i, end);
      if (end < il) {
        newJson += '"';
        state = STATE_NONE;
      }
      i = end + 1;
      continue;
    }

    // Close Nunjucks states
    if (state !== STATE_NONE) {
      const closeState = json.charCodeAt(i + 1) === CLOSE_BRACE ? NUNJUCKS_CLOSE_STATES[json.slice(i, i + 2)] : undefined;
      if (closeState) {
        state = STATE_NONE;
        // Put comments on their own lines
        newJson += closeState === STATE_IN_NUN_COM ? json.slice(i, i + 2) + '\n' + indent(indentLevel) : json.slice(i, i + 2);
        i += 2;
      } else {
        newJson += json[i];
        i++;
      }
      continue;
    }

    // ~~~~~~~~~~~~~~~~~~~~~~ //
    // Handle "nothing" State //
    // ~~~~~~~~~~~~~~~~~~~~~~ //

    // Open Nunjucks states
    const nextState = code === OPEN_BRACE ? NUNJUCKS_OPEN_STATES[json.slice(i, i + 2)] : undefined;
    if (nextState) {
      state = nextState;
      newJson += json.slice(i, i + 2);
      i += 2;
      continue;
    }

    const nextCode = json.charCodeAt(i + 1);
    switch (code) {
      case COMMA:
        newJson += ',\n' + indent(indentLevel);
        i++;
        continue;
      case OPEN_BRACE:
      case OPEN_BRACKET:
        if (nextCode === (code === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET)) {
          newJson += json.slice(i, i + 2);
          i += 2;
        } else {
          indentLevel++;
          newJson += json[i] + '\n' + indent(indentLevel);
          i++;
        }
        continue;
      case CLOSE_BRACE:
      case CLOSE_BRACKET:
        indentLevel--;
        newJson += '\n' + indent(indentLevel) + json[i];
        i++;
        continue;
      case COLON:
        newJson += ': ';
        i++;
        continue;
      case QUOTE:
        state = STATE_IN_STRING;
        newJson += '"';
        i++;
        continue;
      case SPACE:
      case NEWLINE:
      case TAB:
      case RETURN:
        // Don't add whitespace
        i++;
        continue;
      default: {
        let end = i + 1;
        while (end < il && !STRUCTURAL.has(json.charCodeAt(end))) {
          end++;
        }
        newJson += json.slice(i, end);
        i = end;
        continue;
      }
    }
  }

  // Remove lines that only contain whitespace
  return newJson.replace(/^\s*\n/gm, '');
};

const repeatString = (str: string, count: number) => {
  return new Array(count + 1).join(str);
};

/**
 * Convert escaped unicode characters to real characters. Any JSON parser will do this by
 * default. This is really fast too. Around 25ms for ~2MB of data with LOTS of unicode.
 */
const convertUnicode = (originalStr: string) => {
  let m;
  let c;
  let cStr;
  let lastI = 0;

  // Matches \u#### but not \\u####
  const unicodeRegex = /\\u[0-9a-fA-F]{4}/g;

  let convertedStr = '';
  while ((m = unicodeRegex.exec(originalStr))) {
    // Don't convert if the backslash itself is escaped
    if (originalStr[m.index - 1] === '\\') {
      continue;
    }

    try {
      cStr = m[0].slice(2); // Trim off start
      c = String.fromCharCode(parseInt(cStr, 16));
      if (c === '"') {
        // Escape it if it's double quotes
        c = `\\${c}`;
      }

      // + 1 to account for first matched (non-backslash) character
      convertedStr += originalStr.slice(lastI, m.index) + c;
      lastI = m.index + m[0].length;
    } catch (err) {
      // Some reason we couldn't convert a char. Should never actually happen
      console.warn('Failed to convert unicode char', m[0], err);
    }
  }

  // Finally, add the rest of the string to the end.
  convertedStr += originalStr.slice(lastI, originalStr.length);

  return convertedStr;
};
