/**
 * npm run bench -- event-log
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';

import { describe, expect, it } from '@jest/globals';

import { parseServerSentEvents, readLlmStream } from '../common/llm-stream';
import { readEventLog, readEventLogSince } from '../main/network/event-log';
import { median, report } from './seed';

// what a window's poll (twice a second) used to do: read and parse it all
const readAll = async (file: string) => (await fs.promises.readFile(file)).toString().split('\n').filter(e => e?.trim()).map(e => JSON.parse(e)).reverse();

// as curl.ts logs a chunk of the stream: its raw text
const event = (i: number) => JSON.stringify({ _id: `evt_${i}`, requestId: 'req_1', type: 'message', data: `id: ${i}\nevent: tick\ndata: ${JSON.stringify({ i, pad: 'x'.repeat(150) })}\n\n`, timestamp: 1_700_000_000_000 + i }) + '\n';

describe('an event stream\'s log, as a window polls it', () => {
  for (const events of [1000, 10_000, 50_000]) {
    it(`${events} events`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-bench-'));
      const file = path.join(dir, 'log.response');
      fs.writeFileSync(file, Array.from({ length: events }, (_, i) => event(i)).join(''));
      const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);

      report(`a poll reading it all, ${events} events (${mb} MB)`, await median(() => readAll(file)));
      report(`a poll, nothing new, ${events} events`, await median(() => readEventLog(file)));
      let next = events;
      report(`a poll after 10 more, ${events} events`, await median(() => {
        fs.appendFileSync(file, Array.from({ length: 10 }, () => event(next++)).join(''));
        return readEventLog(file);
      }));
      expect((await readEventLog(file)).length).toBe(next);

      // what IPC copies for a poll (structured clone, as v8.serialize): all of them, or only what's new
      report(`  IPC copy, a poll sending them all, ${events} events`, await median(async () => v8.serialize(await readEventLog(file))));
      report(`  IPC copy, a poll sending what's new (none), ${events} events`, await median(async () => v8.serialize(await readEventLogSince(file, next))));

      // and the pane's work on each new list (realtime-response-pane.tsx), now skipped when nothing came
      const all = await readEventLog<{ type: string; data: string; timestamp: number }>(file);
      report(`  the pane's LLM stream check, ${events} events`, await median(() => {
        const inOrder = [...all].sort((a, b) => a.timestamp - b.timestamp);
        const chunks = inOrder.filter(e => e.type === 'message' && typeof e.data === 'string').map(e => ({ data: e.data, timestamp: e.timestamp }));
        return readLlmStream(parseServerSentEvents(chunks), inOrder[0]?.timestamp);
      }));
      fs.rmSync(dir, { recursive: true, force: true });
    }, 120_000);
  }
});
