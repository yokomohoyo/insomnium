/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { comparable, diffLines, diffWithContext } from '../text-diff';

const marks = (before: string, after: string) => diffLines(before, after).lines.map(({ kind, text }) => `${{ same: ' ', removed: '-', added: '+' }[kind]}${text}`);

describe('diffLines()', () => {
  it('finds the lines only one text has, and keeps the rest lined up', () => {
    expect(marks('a\nb\nc\nd', 'a\nc\nx\nd')).toEqual([' a', '-b', ' c', '+x', ' d']);
    expect(diffLines('a\nb\nc\nd', 'a\nc\nx\nd')).toMatchObject({ added: 1, removed: 1 });
  });

  it('numbers each line as it is in its own text', () => {
    expect(diffLines('a\nb\nc', 'a\nx\ny\nc').lines).toEqual([
      { kind: 'same', text: 'a', left: 1, right: 1 },
      { kind: 'removed', text: 'b', left: 2 },
      { kind: 'added', text: 'x', right: 2 },
      { kind: 'added', text: 'y', right: 3 },
      { kind: 'same', text: 'c', left: 3, right: 4 },
    ]);
  });

  it('has nothing to show for the same text, whatever its line endings', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb')).toMatchObject({ added: 0, removed: 0 });
    expect(diffLines('', '')).toEqual({ lines: [], added: 0, removed: 0 });
  });

  it('takes a text against nothing as all added, or all removed', () => {
    expect(marks('', 'a\nb')).toEqual(['+a', '+b']);
    expect(marks('a\nb', '')).toEqual(['-a', '-b']);
  });

  it('lines up a changed line in the middle of a long text', () => {
    const before = Array.from({ length: 500 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[250] = 'changed';

    const diff = diffLines(before.join('\n'), after.join('\n'));
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.lines).toHaveLength(501);
  });

  it('shows one text then the other when they are too long to line up', () => {
    const before = Array.from({ length: 2100 }, (_, index) => `a${index}`).join('\n');
    const after = Array.from({ length: 2100 }, (_, index) => `b${index}`).join('\n');

    expect(diffLines(before, after)).toMatchObject({ tooLong: true, removed: 2100, added: 2100 });
  });
});

describe('diffWithContext()', () => {
  it('keeps what changed and a few lines either side, with a gap where lines are left out', () => {
    const before = Array.from({ length: 20 }, (_, index) => `${index}`);
    const after = [...before];
    after[2] = 'x';
    after[15] = 'y';

    const shown = diffWithContext(diffLines(before.join('\n'), after.join('\n')), 1).map(line => line ? `${{ same: ' ', removed: '-', added: '+' }[line.kind]}${line.text}` : '…');
    expect(shown).toEqual([' 1', '-2', '+x', ' 3', '…', ' 14', '-15', '+y', ' 16']);
  });

  it('is empty for texts that are the same', () => {
    expect(diffWithContext(diffLines('a\nb', 'a\nb'))).toEqual([]);
  });
});

describe('comparable()', () => {
  it('lays JSON out the same way however it was written', () => {
    expect(comparable('{"a":1,"b":[1,2]}')).toBe(comparable('{ "a": 1,\n "b": [1, 2] }'));
    expect(comparable('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('leaves what is not a JSON object or array as it is', () => {
    expect(comparable('<html>')).toBe('<html>');
    expect(comparable('42')).toBe('42');
    expect(comparable('')).toBe('');
  });
});
