/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { readEventLog, readEventLogSince } from '../event-log';

describe('readEventLog()', () => {
  let dir: string;
  let file: string;
  const line = (id: string, data = '') => JSON.stringify({ _id: id, data }) + '\n';
  const ids = async () => (await readEventLog<{ _id: string }>(file)).map(event => event._id);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-log-'));
    file = path.join(dir, 'log.response');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gives the events latest first, with those added since', async () => {
    fs.writeFileSync(file, line('a') + line('b'));
    expect(await ids()).toEqual(['b', 'a']);
    expect(await ids()).toEqual(['b', 'a']);

    fs.appendFileSync(file, line('c'));

    expect(await ids()).toEqual(['c', 'b', 'a']);
  });

  it('leaves a line being written until it is whole', async () => {
    const whole = line('b', 'café ☃');
    // cut inside the snowman's three bytes
    const cut = Buffer.byteLength(whole) - 4;
    fs.writeFileSync(file, line('a'));
    fs.appendFileSync(file, Buffer.from(whole).subarray(0, cut));
    expect(await ids()).toEqual(['a']);

    fs.appendFileSync(file, Buffer.from(whole).subarray(cut));

    expect(await readEventLog(file)).toEqual([{ _id: 'b', data: 'café ☃' }, { _id: 'a', data: '' }]);
  });

  it('reads it all again when it was written afresh', async () => {
    fs.writeFileSync(file, line('a') + line('b'));
    expect(await ids()).toEqual(['b', 'a']);

    fs.writeFileSync(file, line('x'));

    expect(await ids()).toEqual(['x']);
  });

  it('gives only the events after those known, with the total', async () => {
    fs.writeFileSync(file, line('a') + line('b') + line('c'));
    const since = async (known: number) => {
      const { total, added } = await readEventLogSince<{ _id: string }>(file, known);
      return { total, added: added.map(event => event._id) };
    };

    expect(await since(0)).toEqual({ total: 3, added: ['c', 'b', 'a'] });
    expect(await since(1)).toEqual({ total: 3, added: ['c', 'b'] });
    expect(await since(3)).toEqual({ total: 3, added: [] });
    // more than there are: the log was written afresh, so all of them
    expect(await since(5)).toEqual({ total: 3, added: ['c', 'b', 'a'] });
  });

  it('fails for a log that is gone', async () => {
    await expect(readEventLog(path.join(dir, 'gone'))).rejects.toThrow('ENOENT');
  });
});
