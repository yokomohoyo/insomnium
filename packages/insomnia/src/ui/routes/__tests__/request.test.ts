import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ActionFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { sendAction } from '../request';

jest.mock('../../../network/network', () => ({
  fetchRequestData: jest.fn(),
  tryToInterpolateRequest: jest.fn(),
  sendCurlAndWriteTimeline: jest.fn(),
  responseTransform: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const network = require('../../../network/network');

describe('sendAction with Send and Download', () => {
  let tmpDir: string;
  let bodyPath: string;
  let requestId: string;
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-download-'));
    bodyPath = path.join(tmpDir, 'body.bin');
    fs.writeFileSync(bodyPath, 'response body');

    const workspace = await models.workspace.create({ name: 'Workspace' });
    workspaceId = workspace._id;
    const request = await models.request.create({ parentId: workspaceId, name: 'Download Me' });
    requestId = request._id;
    await models.requestMeta.create({ parentId: requestId });

    network.fetchRequestData.mockResolvedValue({
      environment: { _id: 'env_1' },
      settings: { maxHistoryResponses: 20 },
      clientCertificates: [],
      caCert: null,
      activeEnvironmentId: 'env_1',
    });
    network.tryToInterpolateRequest.mockResolvedValue({ context: {} });
    network.sendCurlAndWriteTimeline.mockResolvedValue({});
    network.responseTransform.mockResolvedValue({
      parentId: requestId,
      statusCode: 200,
      bodyPath,
      bodyCompression: null,
      contentType: 'application/octet-stream',
      headers: [{ name: 'Content-Disposition', value: 'attachment; filename="download.bin"' }],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sendAndDownloadTo = async (downloadPath: string) => {
    await models.requestMeta.updateOrCreateByParentId(requestId, { downloadPath });
    await sendAction({
      request: { json: async () => ({ renderedRequest: {}, shouldPromptForPathAfterResponse: true }) },
      params: { requestId, workspaceId },
    } as unknown as ActionFunctionArgs);
    const requestMeta = await models.requestMeta.getByParentId(requestId);
    const response = await models.response.getById(requestMeta?.activeResponseId || '');
    return response;
  };

  it('reports Saved to only once the file is written', async () => {
    const response = await sendAndDownloadTo(tmpDir);

    const target = path.join(tmpDir, 'download.bin');
    expect(response?.error).toBe(`Saved to ${target}`);
    expect(fs.readFileSync(target, 'utf8')).toBe('response body');
  });

  it('reports the failure when the download folder does not exist', async () => {
    const missingDir = path.join(tmpDir, 'missing');
    const response = await sendAndDownloadTo(missingDir);

    const target = path.join(missingDir, 'download.bin');
    expect(response?.error).toContain(`Failed to save to ${target}: `);
    expect(response?.error).toContain('ENOENT');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('reports the failure when writing fails after the file was opened', async () => {
    // Stands in for a full disk: the file opens, then the write fails later
    const failingFile = new Writable({
      write(_chunk, _encoding, callback) {
        setTimeout(() => callback(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })), 10);
      },
    });
    setTimeout(() => failingFile.emit('open', 1), 0);
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(failingFile as fs.WriteStream);

    const response = await sendAndDownloadTo(tmpDir);

    const target = path.join(tmpDir, 'download.bin');
    expect(response?.error).toBe(`Failed to save to ${target}: ENOSPC: no space left on device, write`);
  });

  (process.getuid?.() === 0 ? it.skip : it)('leaves an existing file alone when it cannot be opened', async () => {
    const target = path.join(tmpDir, 'download.bin');
    fs.writeFileSync(target, 'keep me');
    fs.chmodSync(target, 0o444);

    try {
      const response = await sendAndDownloadTo(tmpDir);

      expect(response?.error).toContain(`Failed to save to ${target}: `);
      expect(fs.readFileSync(target, 'utf8')).toBe('keep me');
    } finally {
      fs.chmodSync(target, 0o644);
    }
  });

  it('reports the failure when the body fails mid-download', async () => {
    let reads = 0;
    const failingBody = new Readable({
      read() {
        if (reads++ === 0) {
          this.push('partial');
        } else {
          this.destroy(new Error('body read failed'));
        }
      },
    });
    jest.spyOn(models.response, 'getBodyStream').mockReturnValue(failingBody);

    const response = await sendAndDownloadTo(tmpDir);

    const target = path.join(tmpDir, 'download.bin');
    expect(response?.error).toBe(`Failed to save to ${target}: body read failed`);
  });

  const serveInvalidFileName = () => {
    network.responseTransform.mockResolvedValue({
      parentId: requestId,
      statusCode: 200,
      bodyPath,
      bodyCompression: null,
      contentType: 'application/octet-stream',
      headers: [{ name: 'Content-Disposition', value: 'attachment; filename*=UTF-8\'\'a%00b.bin' }],
    });
  };

  it('reports the failure and closes the body when the file name is not a valid path', async () => {
    serveInvalidFileName();
    const getBodyStream = jest.spyOn(models.response, 'getBodyStream');

    const response = await sendAndDownloadTo(tmpDir);

    const target = path.join(tmpDir, 'a\u0000b.bin');
    expect(response?.error).toContain(`Failed to save to ${target}: `);
    expect(response?.error).toContain('null bytes');
    expect(getBodyStream).toHaveBeenCalledTimes(1);
    const body = getBodyStream.mock.results[0].value as fs.ReadStream;
    expect(body.destroyed).toBe(true);
    // The body file must be closed again, not left open
    await new Promise(resolve => body.closed ? resolve(null) : body.once('close', resolve));
  });

  it('does not raise an unhandled error when the discarded body fails to open', async () => {
    serveInvalidFileName();
    const realGetBodyStream = models.response.getBodyStream;
    let body: fs.ReadStream | undefined;
    jest.spyOn(models.response, 'getBodyStream').mockImplementation((...args) => {
      body = realGetBodyStream(...args) as fs.ReadStream;
      // The body file disappears before the stream has opened it
      fs.rmSync(bodyPath);
      return body;
    });

    const response = await sendAndDownloadTo(tmpDir);
    // An unhandled 'error' from the body stream fails the test while waiting
    await new Promise(resolve => body?.closed ? resolve(null) : body?.once('close', resolve));

    expect(response?.error).toContain('null bytes');
  });

  it('records an error instead of an empty file when the body cannot be read', async () => {
    fs.rmSync(bodyPath);

    const response = await sendAndDownloadTo(tmpDir);

    const target = path.join(tmpDir, 'download.bin');
    expect(response?.error).toBe(`Failed to save to ${target}: the response body could not be read`);
    expect(fs.existsSync(target)).toBe(false);
  });
});
