import { Curl, CurlInfoDebug, HeaderInfo } from '@getinsomnia/node-libcurl';
import electron, { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidV4 } from 'uuid';

import { describeByteSize, generateId, getSetCookieHeaders } from '../../common/misc';
import * as models from '../../models';
import { Environment } from '../../models/environment';
import { Response } from '../../models/response';
import { addSetCookiesToToughCookieJar } from '../../network/set-cookie-util';
import { urlMatchesCertHost } from '../../network/url-matches-cert-host';
import { setDefaultProtocol } from '../../utils/url/protocol';
import { getCaBundle } from './ca-bundle';
import { readEventLog } from './event-log';
import { buildEventStreamCurlRequest, EventStreamConnection } from './event-stream-request';
import { createConfiguredCurlInstance, setCurlMethod } from './libcurl-promise';
import { proxyFor } from './proxy';

export interface CurlConnection extends Curl {
  _id: string;
  requestId: string;
}

export interface CurlOpenEvent {
  _id: string;
  requestId: string;
  type: 'open';
  timestamp: number;
}

export interface CurlMessageEvent {
  _id: string;
  requestId: string;
  type: 'message';
  timestamp: number;
  data: string;
  direction: 'OUTGOING' | 'INCOMING';
}

export interface CurlErrorEvent {
  _id: string;
  requestId: string;
  type: 'error';
  timestamp: number;
  message: string;
  error: Error;
}

export interface CurlCloseEvent {
  _id: string;
  requestId: string;
  type: 'close';
  timestamp: number;
  statusCode: number;
  reason: string;
  wasClean: boolean;
  code: number;
}

export type CurlEvent =
  | CurlOpenEvent
  | CurlMessageEvent
  | CurlErrorEvent
  | CurlCloseEvent;

const CurlConnections = new Map<string, Curl>();
const eventLogFileStreams = new Map<string, fs.WriteStream>();
const timelineFileStreams = new Map<string, fs.WriteStream>();

const parseHeadersAndBuildTimeline = (url: string, headersWithStatus: HeaderInfo) => {
  const { result, ...headers } = headersWithStatus;
  const statusMessage = result?.reason || '';
  const statusCode = result?.code || 0;
  const httpVersion = result?.version;
  const responseHeaders = Object.entries(headers).map(([name, value]) => ({ name, value: value?.toString() || '' }));
  const timeline = [
    { value: `Preparing request to ${url}`, name: 'Text', timestamp: Date.now() },
  ];
  return { timeline, responseHeaders, statusCode, statusMessage, httpVersion };
};
interface OpenCurlRequestOptions extends EventStreamConnection {
  requestId: string;
  workspaceId: string;
  initialPayload?: string;
}
const openCurlConnection = async (
  _event: Electron.IpcMainInvokeEvent,
  options: OpenCurlRequestOptions
): Promise<void> => {
  const existingConnection = CurlConnections.get(options.requestId);

  if (existingConnection) {
    // not the URL: it can carry an API key query param
    console.warn('Connection still open for ' + options.requestId);
    return;
  }
  const request = await models.request.getById(options.requestId);
  const responseId = generateId('res');
  if (!request) {
    console.warn('Could not find request for ' + options.requestId);
    return;
  }

  const responsesDir = path.join(process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData'), 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });

  const responseBodyPath = path.join(responsesDir, uuidV4() + '.response');
  eventLogFileStreams.set(options.requestId, fs.createWriteStream(responseBodyPath));
  const timelinePath = path.join(responsesDir, responseId + '.timeline');
  timelineFileStreams.set(options.requestId, fs.createWriteStream(timelinePath));

  const workspaceMeta = await models.workspaceMeta.getOrCreateByParentId(options.workspaceId);
  const environmentId: string = workspaceMeta.activeEnvironmentId || 'n/a';
  const environment: Environment | null = await models.environment.getById(environmentId || 'n/a');
  const responseEnvironmentId = environment ? environment._id : null;

  try {
    if (!options.url) {
      throw new Error('URL is required');
    }
    const caCert = await models.caCertificate.findByParentId(options.workspaceId);
    const caCertficatePath = caCert?.disabled === false ? caCert.path : null;
    const readyStateChannel = `curl.${request._id}.readyState`;

    const settings = await models.settings.getOrCreate();
    const caCertificate = await getCaBundle(caCertficatePath, settings.useSystemCertificates);
    const systemProxy = !settings.proxyEnabled && settings.useSystemProxy ? await proxyFor(options.url, settings) : null;
    const start = performance.now();
    const clientCertificates = await models.clientCertificate.findByParentId(options.workspaceId);
    const filteredClientCertificates = clientCertificates.filter(c => !c.disabled && urlMatchesCertHost(setDefaultProtocol(c.host, 'https:'), options.url));
    const { req, requestBody, headerStrings } = buildEventStreamCurlRequest(options);
    const { curl, debugTimeline } = createConfiguredCurlInstance({
      req,
      finalUrl: options.url,
      settings,
      caCert: caCertificate,
      certificates: filteredClientCertificates,
      socketPath: options.socketPath,
      systemProxy,
    });
    setCurlMethod(curl, req.method);
    // the request timeout still bounds connecting, so a dead host fails
    if (settings.timeout > 0) {
      curl.setOpt(Curl.option.CONNECTTIMEOUT_MS, settings.timeout);
    }
    if (requestBody !== undefined) {
      curl.setOpt(Curl.option.POSTFIELDS, requestBody);
    }
    debugTimeline.forEach(entry => timelineFileStreams.get(options.requestId)?.write(JSON.stringify(entry) + '\n'));
    CurlConnections.set(options.requestId, curl);
    CurlConnections.get(options.requestId)?.setOpt(Curl.option.HTTPHEADER, headerStrings);
    CurlConnections.get(options.requestId)?.on('error', async (error, errorCode) => {
      const errorEvent: CurlErrorEvent = {
        _id: uuidV4(),
        requestId: options.requestId,
        message: error.message,
        type: 'error',
        error,
        timestamp: Date.now(),
      };
      console.error('curl - error: ', error, errorCode);
      deleteRequestMaps(request._id, error.message, errorEvent);
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(readyStateChannel, false);
      }
      curl.close();
      if (errorCode) {
        const res = await models.response.getById(responseId);
        if (!res) {
          createErrorResponse(responseId, request._id, responseEnvironmentId, timelinePath, error.message || 'Something went wrong');
        }
      }
    });

    // the stream opens as its request goes out: a model's first token and whole
    // reply are timed from here, not from the reply's first chunk
    let opened = false;
    CurlConnections.get(options.requestId)?.setOpt(Curl.option.DEBUGFUNCTION, (infoType, buffer) => {
      if (infoType === CurlInfoDebug.HeaderOut && !opened) {
        opened = true;
        const openEvent: CurlOpenEvent = { _id: uuidV4(), requestId: options.requestId, type: 'open', timestamp: Date.now() };
        eventLogFileStreams.get(options.requestId)?.write(JSON.stringify(openEvent) + '\n');
      }
      const isSSLData = infoType === CurlInfoDebug.SslDataIn || infoType === CurlInfoDebug.SslDataOut;
      const isEmpty = buffer.length === 0;
      // Don't show cookie setting because this will display every domain in the jar
      const isAddCookie = infoType === CurlInfoDebug.Text && buffer.toString('utf8').indexOf('Added cookie') === 0;
      if (isSSLData || isEmpty || isAddCookie) {
        return 0;
      }

      // NOTE: resolves "Text" from CurlInfoDebug[CurlInfoDebug.Text]
      let name = CurlInfoDebug[infoType] as keyof typeof CurlInfoDebug;
      let timelineMessage;
      const isRequestData = infoType === CurlInfoDebug.DataOut;
      if (isRequestData) {
        // Ignore large post data messages
        const isLessThan10KB = buffer.length / 1024 < (settings.maxTimelineDataSizeKB || 1);
        timelineMessage = isLessThan10KB ? buffer.toString('utf8') : `(${describeByteSize(buffer.length)} hidden)`;
      }
      const isResponseData = infoType === CurlInfoDebug.DataIn;
      if (isResponseData) {
        timelineMessage = `Received ${describeByteSize(buffer.length)} chunk`;
        name = 'Text';
      }
      const value = timelineMessage || buffer.toString('utf8');
      timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ name, value, timestamp: Date.now() }) + '\n');
      return 0;
    });

    // The response, once its headers are in: with the body's first chunk, or at
    // the end when there's none. Each chunk goes to the event log as it arrives,
    // from WRITEFUNCTION: node-libcurl's StreamResponse pauses the transfer at
    // the first chunk and resumes it from the progress callback, which libcurl
    // 8.17+ doesn't call for a paused transfer, so a stream stalled there.
    let responded: Promise<void> | undefined;
    const respond = () => responded ??= (async () => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(readyStateChannel, true);
      }
      // the last response's, after any redirects
      const allHeaders = (curl as unknown as { getHeaders: () => HeaderInfo[] }).getHeaders();
      const headersWithStatus = allHeaders[allHeaders.length - 1] || { result: { code: 0, reason: '', version: '' } } as HeaderInfo;
      const { timeline, responseHeaders, statusCode, statusMessage, httpVersion } = parseHeadersAndBuildTimeline(options.url, headersWithStatus);

      const responsePatch: Partial<Response> = {
        _id: responseId,
        parentId: request._id,
        environmentId: responseEnvironmentId,
        headers: responseHeaders,
        url: options.url,
        statusCode,
        statusMessage,
        httpVersion,
        elapsedTime: performance.now() - start,
        timelinePath,
        bodyPath: responseBodyPath,
        settingSendCookies: req.settingSendCookies,
        settingStoreCookies: req.settingStoreCookies,
        bodyCompression: null,
      };
      const settings = await models.settings.getOrCreate();
      const res = await models.response.create(responsePatch, settings.maxHistoryResponses);
      models.requestMeta.updateOrCreateByParentId(request._id, { activeResponseId: res._id });

      if (req.settingStoreCookies) {
        const setCookieStrings: string[] = getSetCookieHeaders(responseHeaders).map(h => h.value);
        const totalSetCookies = setCookieStrings.length;
        if (totalSetCookies) {
          // the last hop's cookies are that URL's, after any redirects
          const currentUrl = String(curl.getInfo(Curl.info.EFFECTIVE_URL) || req.url);
          const { cookies, rejectedCookies } = await addSetCookiesToToughCookieJar({ setCookieStrings, currentUrl, cookieJar: options.cookieJar });
          rejectedCookies.forEach(errorMessage => timeline.push({ value: `Rejected cookie: ${errorMessage}`, name: 'Text', timestamp: Date.now() }));
          const hasCookiesToPersist = totalSetCookies > rejectedCookies.length;
          if (hasCookiesToPersist) {
            await models.cookieJar.update(options.cookieJar, { cookies });
            timeline.push({ value: `Saved ${totalSetCookies} cookies`, name: 'Text', timestamp: Date.now() });
          }
        }
      }
      timeline.map(t => timelineFileStreams.get(options.requestId)?.write(JSON.stringify(t) + '\n'));
    })();

    const decoder = new TextDecoder('utf-8');
    curl.setOpt(Curl.option.WRITEFUNCTION, (chunk: Buffer) => {
      respond();
      const messageEvent: CurlMessageEvent = {
        _id: uuidV4(),
        requestId: options.requestId,
        // a character split across chunks waits for the next one
        data: decoder.decode(chunk, { stream: true }),
        type: 'message',
        timestamp: Date.now(),
        direction: 'INCOMING',
      };
      eventLogFileStreams.get(options.requestId)?.write(JSON.stringify(messageEvent) + '\n');
      return chunk.length;
    });

    // the remote server closed the stream cleanly
    curl.on('end', async () => {
      await respond();
      deleteRequestMaps(request._id, 'Closed by the server');
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(readyStateChannel, false);
      }
      curl.close();
    });
    curl.perform();
  } catch (e) {
    console.error('unhandled error:', e);

    deleteRequestMaps(request._id, e.message || 'Something went wrong');
    createErrorResponse(responseId, request._id, responseEnvironmentId, timelinePath, e.message || 'Something went wrong');
  }
};

const createErrorResponse = async (responseId: string, requestId: string, environmentId: string | null, timelinePath: string, message: string) => {
  const settings = await models.settings.getOrCreate();
  const responsePatch = {
    _id: responseId,
    parentId: requestId,
    environmentId: environmentId,
    timelinePath,
    statusMessage: 'Error',
    error: message,
  };
  const res = await models.response.create(responsePatch, settings.maxHistoryResponses);
  models.requestMeta.updateOrCreateByParentId(requestId, { activeResponseId: res._id });
};

const deleteRequestMaps = async (requestId: string, message: string, event?: CurlCloseEvent | CurlErrorEvent) => {
  if (event) {
    eventLogFileStreams.get(requestId)?.write(JSON.stringify(event) + '\n');
  }
  eventLogFileStreams.get(requestId)?.end();
  eventLogFileStreams.delete(requestId);
  timelineFileStreams.get(requestId)?.write(JSON.stringify({ value: message, name: 'Text', timestamp: Date.now() }) + '\n');
  timelineFileStreams.get(requestId)?.end();
  timelineFileStreams.delete(requestId);
  CurlConnections.delete(requestId);
};

const getCurlReadyState = async (
  options: { requestId: string }
): Promise<CurlConnection['isOpen']> => {
  return CurlConnections.get(options.requestId)?.isOpen ?? false;
};

const closeCurlConnection = (
  _event: Electron.IpcMainInvokeEvent,
  options: { requestId: string }
): void => {
  if (!CurlConnections.get(options.requestId)) {
    return;
  }
  const readyStateChannel = `curl.${options.requestId}.readyState`;
  const statusCode = +(CurlConnections.get(options.requestId)?.getInfo(Curl.info.HTTP_CONNECTCODE) || 0);
  const closeEvent: CurlCloseEvent = {
    _id: uuidV4(),
    requestId: options.requestId,
    type: 'close',
    timestamp: Date.now(),
    statusCode,
    reason: '',
    code: 0,
    wasClean: true,
  };
  CurlConnections.get(options.requestId)?.close();
  deleteRequestMaps(options.requestId, 'Closing connection', closeEvent);
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(readyStateChannel, false);
  }
};

const closeAllCurlConnections = (): void => CurlConnections.forEach(curl => curl.close());

const findMany = async (
  options: { responseId: string }
): Promise<CurlEvent[]> => {
  const response = await models.response.getById(options.responseId);
  if (!response || !response.bodyPath) {
    return [];
  }
  return readEventLog<CurlEvent>(response.bodyPath);
};

export interface CurlBridgeAPI {
  open: (options: OpenCurlRequestOptions) => void;
  close: (options: { requestId: string }) => void;
  closeAll: typeof closeAllCurlConnections;
  readyState: {
    getCurrent: typeof getCurlReadyState;
  };
  event: {
    findMany: typeof findMany;
  };
}
// the same connections, for an MCP client (main/mcp/tools/streams.ts); the
// window sees them as it sees its own
export const eventStreams = {
  open: (options: OpenCurlRequestOptions) => openCurlConnection(null as unknown as Electron.IpcMainInvokeEvent, options),
  close: (requestId: string) => closeCurlConnection(null as unknown as Electron.IpcMainInvokeEvent, { requestId }),
  isOpen: (requestId: string) => getCurlReadyState({ requestId }),
  events: (responseId: string) => findMany({ responseId }),
};

export const registerCurlHandlers = () => {
  ipcMain.handle('curl.open', openCurlConnection);
  ipcMain.on('curl.close', closeCurlConnection);
  ipcMain.on('curl.closeAll', closeAllCurlConnections);
  ipcMain.handle('curl.readyState', (_, options: Parameters<typeof getCurlReadyState>[0]) => getCurlReadyState(options));
  ipcMain.handle('curl.event.findMany', (_, options: Parameters<typeof findMany>[0]) => findMany(options));
};

electron.app.on('window-all-closed', closeAllCurlConnections);
