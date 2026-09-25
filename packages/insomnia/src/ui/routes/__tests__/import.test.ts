import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { scanForResourcesAction, ScanForResourcesActionResult } from '../import';

const scan = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  const request = { formData: async () => formData } as unknown as Request;
  return scanForResourcesAction({ request, params: {}, context: undefined }) as Promise<ScanForResourcesActionResult>;
};

describe('scanForResourcesAction() importFrom=file', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-import-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    'collection.sh',
    'my collection.sh',
    'a#b.sh',
    '100%25 done.sh',
    'colección-ü-日本.sh',
  ])('reads a picked file named %p', async name => {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, 'curl https://example.com/users');

    const result = await scan({ importFrom: 'file', filePath });

    expect(result.errors).toEqual([]);
    expect(result.type?.id).toBe('curl');
    expect(result.requests?.[0]).toMatchObject({ url: 'https://example.com/users' });
  });

  it('passes a Windows path to the file system unchanged', async () => {
    const filePath = 'C:\\Users\\Jane Doe\\Downloads\\a#b 100%.json';
    const readFile = jest.spyOn(fs.promises, 'readFile')
      .mockResolvedValue(Buffer.from('curl https://example.com') as never);

    const result = await scan({ importFrom: 'file', filePath });

    expect(readFile).toHaveBeenCalledWith(filePath);
    expect(result.errors).toEqual([]);
  });

  const har = JSON.stringify({
    log: { entries: [{ request: { method: 'GET', url: 'https://example.com/users' } }] },
  });

  it.each([
    ['no byte order mark', Buffer.from(har, 'utf8')],
    ['a UTF-8 byte order mark', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(har, 'utf8')])],
    ['UTF-16LE with a byte order mark', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(har, 'utf16le')])],
  ])('reads a JSON file with %s', async (_, bytes) => {
    const filePath = path.join(dir, 'export.har');
    fs.writeFileSync(filePath, bytes);

    const result = await scan({ importFrom: 'file', filePath });

    expect(result.errors).toEqual([]);
    expect(result.type?.id).toBe('har');
    expect(result.requests?.[0]).toMatchObject({ url: 'https://example.com/users' });
  });

  it('returns a read error instead of throwing', async () => {
    const result = await scan({ importFrom: 'file', filePath: path.join(dir, 'missing.json') });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/ENOENT/);
  });
});

describe('scanForResourcesAction() importFrom=uri', () => {
  it('still refuses file:// URIs, as supplied by insomnia://app/import deep links', async () => {
    const result = await scan({ importFrom: 'uri', uri: 'file:///etc/passwd' });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Unsupported import URI scheme/);
    expect(result.requests).toBeUndefined();
  });
});
