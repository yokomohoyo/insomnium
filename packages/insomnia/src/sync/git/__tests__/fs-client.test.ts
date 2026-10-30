import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { fsClient } from '../fs-client';

describe('fsClient', () => {
  it('never shows a file half written: a read while it is rewritten finds the old or the new one', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-client-'));
    const { promises: client } = fsClient(base);
    // big, as the index gets, so a plain write is caught midway
    const ours = 'a'.repeat(4 * 1024 * 1024);
    const theirs = 'b'.repeat(4 * 1024 * 1024);
    await client.writeFile('index', ours);

    const torn: number[] = [];
    for (let i = 0; i < 20; i++) {
      await Promise.all([
        client.writeFile('index', i % 2 ? ours : theirs),
        client.readFile('index', 'utf8').then(content => {
          if (content !== ours && content !== theirs) {
            torn.push((content as string).length);
          }
        }),
      ]);
    }

    expect(torn).toEqual([]);
    // nothing left beside it
    expect(fs.readdirSync(base)).toEqual(['index']);
    expect(fs.readdirSync(`${base}.tmp`)).toEqual([]);
  });
});
