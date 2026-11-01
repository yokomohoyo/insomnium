// npm run bench -- sse-parse
import { describe, expect, it } from '@jest/globals';

import { parseServerSentEvents } from '../common/llm-stream';
import { median, report } from './seed';

// The Event Stream pane looks for a model's reply in the stream's chunks
// (realtime-response-pane.tsx), each time new ones arrive.
describe('parsing a stream\'s chunks into events', () => {
  for (const chunks of [1000, 10_000]) {
    it(`one large event in ${chunks} chunks, with no line end until the last`, async () => {
      const piece = 'x'.repeat(100);
      const stream = [
        { data: 'data: ', timestamp: 0 },
        ...Array.from({ length: chunks }, (_, i) => ({ data: piece, timestamp: i + 1 })),
        { data: '\n\n', timestamp: chunks + 1 },
      ];
      report(`one event in ${chunks} chunks`, await median(() => parseServerSentEvents(stream), 3));
      expect(parseServerSentEvents(stream)[0].data.length).toBe(chunks * 100);
    }, 300_000);
  }

  it('10000 events, a chunk each', async () => {
    const stream = Array.from({ length: 10_000 }, (_, i) => ({ data: `id: ${i}\ndata: {"i":${i}}\n\n`, timestamp: i }));
    report('10000 events, a chunk each', await median(() => parseServerSentEvents(stream), 3));
  });
});
