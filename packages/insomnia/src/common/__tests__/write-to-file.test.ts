import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { writeToFile } from '../write-to-file';

describe('writeToFile()', () => {
  let tmpDir: string;
  let bodyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-write-'));
    bodyPath = path.join(tmpDir, 'body.bin');
    fs.writeFileSync(bodyPath, 'response body');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const closed = (stream: Readable) => new Promise(resolve => stream.closed ? resolve(null) : stream.once('close', resolve));

  it('writes strings, buffers and streams in order', async () => {
    const target = path.join(tmpDir, 'out.txt');

    const error = await writeToFile(target, 'HTTP/1.1 200 OK\r\n\r\n', Buffer.from('['), fs.createReadStream(bodyPath), ']');

    expect(error).toBeNull();
    expect(fs.readFileSync(target, 'utf8')).toBe('HTTP/1.1 200 OK\r\n\r\n[response body]');
  });

  it('returns the error and closes every stream when the file cannot be opened', async () => {
    const target = path.join(tmpDir, 'missing', 'out.txt');
    const first = fs.createReadStream(bodyPath);
    const second = fs.createReadStream(bodyPath);

    const error = await writeToFile(target, first, second);

    expect(error).toMatchObject({ code: 'ENOENT' });
    await closed(first);
    await closed(second);
  });

  it('returns the error and closes the stream when the path is invalid', async () => {
    const body = fs.createReadStream(bodyPath);

    const error = await writeToFile(path.join(tmpDir, 'a\u0000b.txt'), 'headers', body);

    expect(error?.message).toContain('null bytes');
    expect(body.destroyed).toBe(true);
    await closed(body);
  });

  it('returns the error when a stream fails to read', async () => {
    const target = path.join(tmpDir, 'out.txt');

    // Reading a folder fails with EISDIR after it was opened
    const error = await writeToFile(target, 'headers', fs.createReadStream(tmpDir));

    expect(error).toMatchObject({ code: 'EISDIR' });
  });

  it('creates no file when the body cannot be read at all', async () => {
    const target = path.join(tmpDir, 'out.txt');

    const error = await writeToFile(target, fs.createReadStream(tmpDir));

    expect(error).toMatchObject({ code: 'EISDIR' });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('writes an empty file for an empty body', async () => {
    const target = path.join(tmpDir, 'out.txt');
    fs.writeFileSync(bodyPath, '');

    const error = await writeToFile(target, fs.createReadStream(bodyPath));

    expect(error).toBeNull();
    expect(fs.readFileSync(target, 'utf8')).toBe('');
  });

  it('returns the error of a stream that fails before it is read', async () => {
    const target = path.join(tmpDir, 'out.txt');
    // The headers fill the file's write buffer, so the stream fails to open
    // before writeToFile gets to it
    const body = fs.createReadStream(path.join(tmpDir, 'missing.bin'));

    const error = await writeToFile(target, 'h'.repeat(1_000_000), body);

    expect(error).toMatchObject({ code: 'ENOENT' });
    await closed(body);
  });

  it('returns the error and closes a stream that is waiting for data when the file cannot be opened', async () => {
    const target = path.join(tmpDir, 'missing', 'out.txt');
    const body = new PassThrough();
    body.write('first chunk');

    const error = await writeToFile(target, 'headers', body);

    expect(error).toMatchObject({ code: 'ENOENT' });
    expect(body.destroyed).toBe(true);
  });
});
