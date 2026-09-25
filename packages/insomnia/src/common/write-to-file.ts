import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { types } from 'node:util';

/**
 * Writes the parts to filePath in order, streaming any Readable part. Resolves
 * with the error instead of throwing, and without one only once the file has
 * been fully written and closed.
 */
export const writeToFile = async (filePath: string, ...parts: (string | Buffer | Readable)[]): Promise<Error | null> => {
  const streams = parts.filter((part): part is Readable => part instanceof Readable);
  // A stream is only read once the parts before it are written, so an error it
  // emits before then would go unhandled. It is not lost: reading a stream that
  // has already failed throws its error.
  for (const stream of streams) {
    stream.on('error', () => {});
  }
  const closeStreams = () => {
    for (const stream of streams) {
      stream.destroy();
    }
  };

  try {
    const chunks = (async function* () {
      for (const part of parts) {
        if (part instanceof Readable) {
          yield* part;
        } else {
          yield part;
        }
      }
    })();
    // Create the file only once there is something to write (or the parts turn
    // out to be empty), so a body that cannot be read leaves no empty file.
    const first = await chunks.next();
    // Unlike pipe(), pipeline() reports errors from either side and only
    // completes once the file has been fully written and closed.
    // The signal is optional only in the typings; pipeline() always passes it.
    await pipeline(async function* ({ signal }: { signal?: AbortSignal } = {}) {
      // pipeline() aborts when writing fails. Closing the streams then stops
      // one that is waiting for data, which would otherwise keep it waiting.
      signal?.addEventListener('abort', closeStreams, { once: true });
      if (!first.done) {
        yield first.value;
      }
      yield* chunks;
    }, createWriteStream(filePath));
    return null;
  } catch (err) {
    // createWriteStream throws before pipeline() runs for an invalid path (e.g.
    // a NUL byte in the name), and a failed write may stop before a later part
    // was read, so close every stream here.
    closeStreams();
    // isNativeError, unlike instanceof, also accepts an Error from another
    // realm, so it is returned as is instead of being wrapped.
    return types.isNativeError(err) ? err : new Error(String(err));
  }
};
