// Two texts, line by line: what the Comparer shows. The lines both have are
// found as the longest run of them in order (a longest common subsequence),
// so a line that was added or taken out doesn't make everything after it look
// changed.

export interface DiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
  // its line number in the first text, and in the second
  left?: number;
  right?: number;
}

export interface TextDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  // the texts were too long to line up, so they're shown one after the other
  tooLong?: boolean;
}

// as many line pairs as are lined up: beyond it the table would take too long
// and too much memory, and nobody reads a diff that size
const MOST_CELLS = 4_000_000;

const split = (text: string) => text === '' ? [] : text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');

export const diffLines = (before: string, after: string): TextDiff => {
  const a = split(before);
  const b = split(after);
  const lines: DiffLine[] = [];

  // what both start and end with needs no lining up
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  for (let index = 0; index < start; index++) {
    lines.push({ kind: 'same', text: a[index], left: index + 1, right: index + 1 });
  }

  const rows = endA - start;
  const columns = endB - start;
  let tooLong = false;
  if (rows * columns > MOST_CELLS) {
    tooLong = true;
    for (let index = start; index < endA; index++) {
      lines.push({ kind: 'removed', text: a[index], left: index + 1 });
    }
    for (let index = start; index < endB; index++) {
      lines.push({ kind: 'added', text: b[index], right: index + 1 });
    }
  } else if (rows || columns) {
    // lengths[i][j]: the longest run common to a from i and b from j
    const width = columns + 1;
    const lengths = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = columns - 1; j >= 0; j--) {
        lengths[i * width + j] = a[start + i] === b[start + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows || j < columns) {
      if (i < rows && j < columns && a[start + i] === b[start + j]) {
        lines.push({ kind: 'same', text: a[start + i], left: start + i + 1, right: start + j + 1 });
        i++;
        j++;
      } else if (j < columns && (i === rows || lengths[i * width + j + 1] > lengths[(i + 1) * width + j])) {
        lines.push({ kind: 'added', text: b[start + j], right: start + j + 1 });
        j++;
      } else {
        lines.push({ kind: 'removed', text: a[start + i], left: start + i + 1 });
        i++;
      }
    }
  }

  for (let index = endA; index < a.length; index++) {
    lines.push({ kind: 'same', text: a[index], left: index + 1, right: endB + (index - endA) + 1 });
  }
  return {
    lines,
    added: lines.filter(({ kind }) => kind === 'added').length,
    removed: lines.filter(({ kind }) => kind === 'removed').length,
    ...(tooLong ? { tooLong } : {}),
  };
};

// A diff with only what changed and a few lines either side: `null` stands
// for the lines left out between two parts
export const diffWithContext = ({ lines }: Pick<TextDiff, 'lines'>, context = 3): (DiffLine | null)[] => {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach(({ kind }, index) => {
    if (kind !== 'same') {
      for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near++) {
        keep[near] = true;
      }
    }
  });
  const shown: (DiffLine | null)[] = [];
  lines.forEach((line, index) => {
    if (keep[index]) {
      shown.push(line);
    } else if (shown.length && shown[shown.length - 1] !== null && keep.indexOf(true, index) !== -1) {
      shown.push(null);
    }
  });
  return shown;
};

// a body to compare: JSON laid out the same way both times, so a difference
// in spacing or key order of the layout isn't shown as one in the data
export const comparable = (body: string) => {
  try {
    const value = JSON.parse(body);
    return value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : body;
  } catch {
    return body;
  }
};
