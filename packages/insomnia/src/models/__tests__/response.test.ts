import { beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';

describe('migrate()', () => {
  beforeEach(globalBeforeEach);

  it('does it', async () => {
    const bodyPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'insomnia-body-')), 'foo.zip');
    fs.writeFileSync(bodyPath, zlib.gzipSync('Hello World!'));
    const response = await models.initModel(models.response.type, {
      bodyPath,
    });
    const body = await models.response.getBodyBuffer(response).toString();
    expect(response.bodyCompression).toBe('zip');
    expect(body).toBe('Hello World!');
  });

  it('migrates leaves bodyCompression for null', async () => {
    expect(
      (
        await models.initModel(models.response.type, {
          bodyPath: '/foo/bar',
          bodyCompression: null,
        })
      ).bodyCompression,
    ).toBe(null);
  });

  it('migrates sets bodyCompression to zip if does not have one yet', async () => {
    expect(
      (
        await models.initModel(models.response.type, {
          bodyPath: '/foo/bar',
        })
      ).bodyCompression,
    ).toBe('zip');
  });

  it('migrates leaves bodyCompression if string', async () => {
    expect(
      (
        await models.initModel(models.response.type, {
          bodyPath: '/foo/bar',
          bodyCompression: 'zip',
        })
      ).bodyCompression,
    ).toBe('zip');
  });
});

describe('getBoundedBodyBuffer()', () => {
  beforeEach(globalBeforeEach);

  // mkdtempSync = unpredictable dir (avoids the insecure-temp-file class CodeQL flags).
  const writeBody = (name: string, content: string, compress: boolean) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnia-body-'));
    const bodyPath = path.join(dir, name);
    fs.writeFileSync(bodyPath, compress ? zlib.gzipSync(content) : Buffer.from(content));
    return bodyPath;
  };

  it('reads a full small gzip body and reports the exact size', async () => {
    const bodyPath = writeBody('small.zip', 'Hello World!', true);
    const { buffer, truncated, fullSize } = await models.response.getBoundedBodyBuffer({ bodyPath, bodyCompression: 'zip' }, 100_000);
    expect(buffer.toString()).toBe('Hello World!');
    expect(truncated).toBe(false);
    expect(fullSize).toBe(12);
  });

  it('reads a full uncompressed body', async () => {
    const bodyPath = writeBody('small.raw', 'plain body', false);
    const { buffer, truncated, fullSize } = await models.response.getBoundedBodyBuffer({ bodyPath, bodyCompression: null }, 100_000);
    expect(buffer.toString()).toBe('plain body');
    expect(truncated).toBe(false);
    expect(fullSize).toBe(10);
  });

  it('stops early on a large gzip body without decompressing all of it', async () => {
    const big = 'x'.repeat(5_000_000); // 5MB decompressed, highly compressible
    const bodyPath = writeBody('big.zip', big, true);
    const { buffer, truncated, fullSize } = await models.response.getBoundedBodyBuffer({ bodyPath, bodyCompression: 'zip' }, 1024);
    expect(truncated).toBe(true);
    expect(fullSize).toBeNull(); // unknown - we deliberately stopped
    expect(buffer.length).toBeGreaterThanOrEqual(1024);
    expect(buffer.length).toBeLessThan(big.length); // did not materialize the whole body
  });

  it('reports a corrupt gzip body as truncated with unknown size, without throwing', async () => {
    const bodyPath = writeBody('corrupt.zip', 'this is not gzip data', false); // bogus, will fail gunzip
    const { truncated, fullSize } = await models.response.getBoundedBodyBuffer({ bodyPath, bodyCompression: 'zip' }, 100_000);
    expect(truncated).toBe(true);
    expect(fullSize).toBeNull();
  });

  it('returns empty for a missing/absent body', async () => {
    const none = await models.response.getBoundedBodyBuffer({ bodyPath: '' }, 1024);
    expect(none.buffer.length).toBe(0);
    expect(none.fullSize).toBe(0);
    const missing = await models.response.getBoundedBodyBuffer({ bodyPath: '/nope/does-not-exist.zip', bodyCompression: 'zip' }, 1024);
    expect(missing.buffer.length).toBe(0);
    expect(missing.fullSize).toBeNull();
  });
});
