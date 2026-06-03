import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  classifyProtoUrl,
  fetchProto,
  githubBlobToRawUrl,
} from '../proto-fetcher';

describe('classifyProtoUrl', () => {
  it.each([
    ['https://github.com/foo/bar/blob/main/svc.proto',             'github-blob'],
    ['https://github.com/foo/bar/tree/main/protos',                'github-tree'],
    ['https://github.com/foo/bar/tree/main',                       'github-tree'],
    ['https://raw.githubusercontent.com/foo/bar/main/svc.proto',   'github-raw'],
    ['buf.build/connectrpc/eliza',                                 'bsr'],
    ['buf.build/connectrpc/eliza:v1.0.0',                          'bsr'],
    ['https://buf.build/connectrpc/eliza',                         'bsr'],
    ['https://example.com/api/svc.proto',                          'https-raw'],
  ])('classifies %s as %s', (url, kind) => {
    expect(classifyProtoUrl(url)?.kind).toBe(kind);
  });

  it.each([
    'https://example.com/not-a-proto',
    'http://insecure.com/svc.proto',
    'ftp://files/svc.proto',
    'just a string',
    '',
  ])('rejects %p', input => {
    expect(classifyProtoUrl(input)).toBeNull();
  });
});

describe('githubBlobToRawUrl', () => {
  it('rewrites blob URLs to raw.githubusercontent.com', () => {
    expect(
      githubBlobToRawUrl('https://github.com/foo/bar/blob/main/api/svc.proto'),
    ).toBe('https://raw.githubusercontent.com/foo/bar/main/api/svc.proto');
  });

  it('preserves the ref (branch/tag/sha)', () => {
    expect(
      githubBlobToRawUrl('https://github.com/foo/bar/blob/v1.2.3/svc.proto'),
    ).toBe('https://raw.githubusercontent.com/foo/bar/v1.2.3/svc.proto');
  });

  it('throws on non-blob URLs', () => {
    expect(() => githubBlobToRawUrl('https://example.com/foo.proto')).toThrow(/Not a GitHub blob URL/);
  });
});

describe('fetchProto', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const okText = (text: string) =>
    Promise.resolve({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(text) } as Response);
  const okJson = (json: unknown) =>
    Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(json) } as Response);

  it('fetches a single github blob proto', async () => {
    fetchMock.mockReturnValueOnce(okText('syntax = "proto3";'));
    const result = await fetchProto('https://github.com/foo/bar/blob/main/svc.proto');
    expect(fetchMock.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/foo/bar/main/svc.proto');
    expect(result).toEqual({
      rootName: 'svc.proto',
      isDirectory: false,
      files: [{ path: 'svc.proto', protoText: 'syntax = "proto3";' }],
    });
  });

  it('walks a github tree, fetching only .proto files', async () => {
    // The walk iterates entries in returned order:
    //   1. list top → 2. download svc.proto → 3. list sub → 4. download inner.proto
    fetchMock.mockReturnValueOnce(okJson([
      { name: 'svc.proto', path: 'protos/svc.proto', type: 'file', download_url: 'https://r/protos/svc.proto' },
      { name: 'README.md', path: 'protos/README.md', type: 'file', download_url: 'https://r/protos/README.md' },
      { name: 'sub', path: 'protos/sub', type: 'dir', download_url: null },
    ]));
    fetchMock.mockReturnValueOnce(okText('outer'));
    fetchMock.mockReturnValueOnce(okJson([
      { name: 'inner.proto', path: 'protos/sub/inner.proto', type: 'file', download_url: 'https://r/protos/sub/inner.proto' },
    ]));
    fetchMock.mockReturnValueOnce(okText('inner'));

    const result = await fetchProto('https://github.com/foo/bar/tree/main/protos');
    expect(result.isDirectory).toBe(true);
    expect(result.rootName).toBe('protos');
    expect(result.files).toEqual([
      { path: 'svc.proto', protoText: 'outer' },
      { path: 'sub/inner.proto', protoText: 'inner' },
    ]);
  });

  it('throws when github tree has no .proto files', async () => {
    fetchMock.mockReturnValueOnce(okJson([
      { name: 'README.md', path: 'README.md', type: 'file', download_url: 'https://r/README.md' },
    ]));
    await expect(fetchProto('https://github.com/foo/bar/tree/main')).rejects.toThrow(/No \.proto files/);
  });

  it('decodes BSR files from base64', async () => {
    fetchMock.mockReturnValueOnce(okJson({
      module: {
        files: [
          { path: 'eliza.proto',   content: Buffer.from('syntax = "proto3";').toString('base64') },
          { path: 'IGNORED.md',    content: Buffer.from('# notes').toString('base64') },
        ],
      },
    }));
    const result = await fetchProto('buf.build/connectrpc/eliza');
    expect(result.rootName).toBe('eliza');
    expect(result.files).toEqual([
      { path: 'eliza.proto', protoText: 'syntax = "proto3";' },
    ]);
  });

  it('passes the ref through to BSR (default: main)', async () => {
    fetchMock.mockReturnValueOnce(okJson({
      module: { files: [{ path: 'a.proto', content: Buffer.from('x').toString('base64') }] },
    }));
    await fetchProto('buf.build/connectrpc/eliza:v1.2.3');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body).toEqual({ owner: 'connectrpc', repository: 'eliza', reference: 'v1.2.3' });
  });

  it('rejects unsupported URLs with a helpful message', async () => {
    await expect(fetchProto('javascript:alert(1)')).rejects.toThrow(/Unrecognized proto source/);
  });

  describe('auth tokens', () => {
    it('attaches Bearer header to GitHub blob fetches when githubToken is set', async () => {
      fetchMock.mockReturnValueOnce(okText('syntax = "proto3";'));
      await fetchProto('https://github.com/foo/bar/blob/main/svc.proto', { githubToken: 'gh_abc' });
      const [calledUrl, init] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('https://raw.githubusercontent.com/foo/bar/main/svc.proto');
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer gh_abc');
    });

    it('attaches Bearer header to every call in a GitHub tree walk', async () => {
      fetchMock.mockReturnValueOnce(okJson([
        { name: 'svc.proto', path: 'svc.proto', type: 'file', download_url: 'https://r/svc.proto' },
      ]));
      fetchMock.mockReturnValueOnce(okText('outer'));
      await fetchProto('https://github.com/foo/bar/tree/main', { githubToken: 'gh_xyz' });
      for (const [, init] of fetchMock.mock.calls) {
        expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer gh_xyz');
      }
    });

    it('attaches Bearer header to BSR Download when bufToken is set', async () => {
      fetchMock.mockReturnValueOnce(okJson({
        module: { files: [{ path: 'a.proto', content: Buffer.from('x').toString('base64') }] },
      }));
      await fetchProto('buf.build/private/team', { bufToken: 'bsr_secret' });
      const [, init] = fetchMock.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer bsr_secret');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('omits Authorization header when no token is set', async () => {
      fetchMock.mockReturnValueOnce(okText('syntax = "proto3";'));
      await fetchProto('https://github.com/foo/bar/blob/main/svc.proto');
      const [, init] = fetchMock.mock.calls[0];
      // When no headers are passed, fetch is called without an init object at all.
      expect((init as RequestInit | undefined)?.headers).toBeUndefined();
    });
  });

  it('surfaces HTTP errors clearly', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve(''),
    } as Response));
    await expect(
      fetchProto('https://github.com/foo/bar/blob/main/svc.proto'),
    ).rejects.toThrow(/404 Not Found/);
  });
});
