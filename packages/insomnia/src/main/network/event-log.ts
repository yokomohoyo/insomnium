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
  const { size } = await fs.promises.stat(file);
  let read = reads.get(file);
  // (smaller: written again from the start)
  if (!read || size < read.size) {
    read = { size: 0, events: [] };
  }
  if (size > read.size) {
    const added = Buffer.alloc(size - read.size);
    const handle = await fs.promises.open(file, 'r');
    try {
      await handle.read(added, 0, added.length, read.size);
    } finally {
      await handle.close();
    }
    // whole lines only: the last may be half written (and a newline byte is never part of a character)
    const end = added.lastIndexOf(0x0a) + 1;
    const events = added.subarray(0, end).toString().split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    read = { size: read.size + end, events: [...read.events, ...events] };
  }
  reads.delete(file);
  reads.set(file, read);
  if (reads.size > KEPT) {
    reads.delete(reads.keys().next().value!);
  }
  return [...read.events].reverse() as T[];
}
