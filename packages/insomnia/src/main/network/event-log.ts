import fs from 'fs';

// A connection's event log (a JSON event a line, appended as they arrive),
// latest first. A window asks for it twice a second while the response is
// shown, open or closed, so what has been read is kept, and only what was
// added since is read and parsed.
interface Read {
  size: number;
  events: unknown[];
}
const reads = new Map<string, Read>();
// logs kept: a few responses on view, in a window or over MCP
const KEPT = 8;

export async function readEventLog<T>(file: string): Promise<T[]> {
  return [...(await readLog(file))].reverse() as T[];
}

// The events after the first `known` (latest first), and how many there are
// in all, so a window that has `known` of them is sent only what is new. All
// of them when it has more than there are (the log was written afresh).
export async function readEventLogSince<T>(file: string, known: number): Promise<{ total: number; added: T[] }> {
  const events = await readLog(file);
  const from = known <= events.length ? known : 0;
  return { total: events.length, added: events.slice(from).reverse() as T[] };
}

// in the order written; not to be changed
async function readLog(file: string): Promise<unknown[]> {
  let read = reads.get(file);
  // its size and what was added, from the one open file
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    // (smaller: written again from the start)
    if (!read || size < read.size) {
      read = { size: 0, events: [] };
    }
    if (size > read.size) {
      const added = Buffer.alloc(size - read.size);
      const { bytesRead } = await handle.read(added, 0, added.length, read.size);
      // whole lines only: the last may be half written (and a newline byte is never part of a character)
      const end = added.subarray(0, bytesRead).lastIndexOf(0x0a) + 1;
      const events = added.subarray(0, end).toString().split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
      read = { size: read.size + end, events: [...read.events, ...events] };
    }
  } finally {
    await handle.close();
  }
  reads.delete(file);
  reads.set(file, read);
  if (reads.size > KEPT) {
    reads.delete(reads.keys().next().value!);
  }
  return read.events;
}
