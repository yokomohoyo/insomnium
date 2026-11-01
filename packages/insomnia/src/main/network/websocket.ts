import electron, { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import { IncomingMessage } from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import path from 'path';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { KeyObject, PxfObject } from 'tls';
import { v4 as uuidV4 } from 'uuid';
import {
  CloseEvent,
  ErrorEvent,
  Event,
  MessageEvent,
  WebSocket,
} from 'ws';

import { AUTH_API_KEY, AUTH_BASIC, AUTH_BEARER } from '../../common/constants';
import { jarFromCookies } from '../../common/cookies';
import { generateId, getSetCookieHeaders } from '../../common/misc';
import { webSocketRequest } from '../../models';
import * as models from '../../models';
import { CookieJar } from '../../models/cookie-jar';
import { getAuthStrategies, RequestAuthentication, RequestHeader } from '../../models/request';
import { BaseWebSocketRequest } from '../../models/websocket-request';
import type { WebSocketResponse } from '../../models/websocket-response';
import { COOKIE, HEADER, QUERY_PARAMS } from '../../network/api-key/constants';
import { getBasicAuthHeader } from '../../network/basic-auth/get-header';
import { getBearerAuthHeader } from '../../network/bearer-auth/get-header';
import { lookupRefusingMetadata, metadataGuarded } from '../../network/metadata-hosts';
import { addSetCookiesToToughCookieJar } from '../../network/set-cookie-util';
import { urlMatchesCertHost } from '../../network/url-matches-cert-host';
import { guard } from '../../utils/guard';
import { setDefaultProtocol } from '../../utils/url/protocol';
import { buildQueryStringFromParams, joinUrlAndQueryString } from '../../utils/url/querystring';
import { getCaBundle } from './ca-bundle';
import { readEventLog, readEventLogSince } from './event-log';
import { connectionInit, GraphqlSubscription, graphqlWsReplies, withGraphqlProtocol } from './graphql-ws';
import { MQTT_PROTOCOL, type MqttOptions, type MqttPublish, MqttSession } from './mqtt';
import { SocketIoOptions, socketIoReplies, socketIoUrl } from './socket-io';
import { BinaryEncoding, bytesOf, loggedData, payloadBytes, reconnectLimits } from './websocket-frames';
import { onWebSocketRedirect } from './websocket-redirect';
import { describeProxy, proxyFor } from './proxy';

export interface WebSocketConnection extends WebSocket {
  _id: string;
  requestId: string;
}

export type WebSocketOpenEvent = Omit<Event, 'target'> & {
  _id: string;
  requestId: string;
  type: 'open';
  timestamp: number;
};

export type WebSocketMessageEvent = Omit<MessageEvent, 'target'> & {
  _id: string;
  requestId: string;
  direction: 'OUTGOING' | 'INCOMING';
  type: 'message';
  timestamp: number;
  // a binary frame: data is its bytes as base64 (websocket-frames.ts)
  binary?: true;
};

export type WebSocketErrorEvent = Omit<ErrorEvent, 'target'> & {
  _id: string;
  requestId: string;
  type: 'error';
  timestamp: number;
};

export type WebSocketCloseEvent = Omit<CloseEvent, 'target'> & {
  _id: string;
  requestId: string;
  type: 'close';
  timestamp: number;
};

export type WebSocketEvent =
  | WebSocketOpenEvent
  | WebSocketMessageEvent
  | WebSocketErrorEvent
  | WebSocketCloseEvent;

export type WebSocketEventLog = WebSocketEvent[];

const WebSocketConnections = new Map<string, WebSocket>();
const MqttSessions = new Map<string, MqttSession>();
const eventLogFileStreams = new Map<string, fs.WriteStream>();
const timelineFileStreams = new Map<string, fs.WriteStream>();

// Reconnecting (the request's reconnect setting): a connection that drops after
// opening is opened again into the same response, its event log and timeline
// carrying on, until it opens or the attempts run out. Closes the user, the app
// or the server's HTTP answer asked for don't reconnect.
interface Resume {
  responseId: string;
  eventLogPath: string;
  timelinePath: string;
}
interface Reconnect {
  options: OpenWebSocketRequestOptions;
  resume: Resume;
  attempt: number;
  timer?: NodeJS.Timeout;
  // reading the request's setting, after a drop
  deciding?: boolean;
  // when it last opened: one that stays open STABLE_MS starts the count again
  openedAt?: number;
}
const STABLE_MS = 10_000;
const Reconnects = new Map<string, Reconnect>();
const ClosingOnPurpose = new Set<string>();

const closeOnPurpose = (requestId: string, ws: WebSocket, code?: number, reason?: string) => {
  ClosingOnPurpose.add(requestId);
  ws.close(code, reason);
};

const cancelReconnect = (requestId: string) => {
  clearTimeout(Reconnects.get(requestId)?.timer);
  Reconnects.delete(requestId);
};

// open, or waiting to reconnect: either way the request shows Disconnect
const isConnected = (requestId: string) =>
  WebSocketConnections.get(requestId)?.readyState === WebSocket.OPEN || !!Reconnects.get(requestId)?.timer;

const broadcastReadyState = (requestId: string) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(`webSocket.${requestId}.readyState`, isConnected(requestId));
  }
};

const appendLine = (file: string, value: string) =>
  fs.promises.appendFile(file, JSON.stringify({ value, name: 'Text', timestamp: Date.now() }) + '\n').catch(() => {});

const parseResponseAndBuildTimeline = (url: string, incomingMessage: IncomingMessage, clientRequestHeaders: string) => {
  const statusMessage = incomingMessage.statusMessage || '';
  const statusCode = incomingMessage.statusCode || 0;
  const httpVersion = incomingMessage.httpVersion;
  const responseHeaders = Object.entries(incomingMessage.headers).map(([name, value]) => ({ name, value: value?.toString() || '' }));
  const headersIn = responseHeaders.map(({ name, value }) => `${name}: ${value}`).join('\n');
  const timeline = [
    { value: `Preparing request to ${url}`, name: 'Text', timestamp: Date.now() },
    { value: `Current time is ${new Date().toISOString()}`, name: 'Text', timestamp: Date.now() },
    { value: 'Using HTTP 1.1', name: 'Text', timestamp: Date.now() },
    { value: clientRequestHeaders, name: 'HeaderOut', timestamp: Date.now() },
    { value: `HTTP/${httpVersion} ${statusCode} ${statusMessage}`, name: 'HeaderIn', timestamp: Date.now() },
    { value: headersIn, name: 'HeaderIn', timestamp: Date.now() },
  ];
  return { timeline, responseHeaders, statusCode, statusMessage, httpVersion };
};
interface OpenWebSocketRequestOptions {
  requestId: string;
  workspaceId: string;
  url: string;
  headers: RequestHeader[];
  authentication: RequestAuthentication;
  cookieJar: CookieJar;
  initialPayload?: string;
  // the initial payload is hex or base64, sent as a binary frame
  initialPayloadBinary?: BinaryEncoding;
  // subscribe once connected, with the graphql-transport-ws protocol
  graphqlSubscription?: GraphqlSubscription;
  // speak Socket.IO: its transport URL, its namespace connect and heartbeat
  socketIo?: SocketIoOptions;
  // speak MQTT 3.1.1 (mqtt.ts): connect, subscribe, keep alive
  mqtt?: MqttOptions;
}
const openWebSocketConnection = async (
  _event: Electron.IpcMainInvokeEvent | null,
  options: OpenWebSocketRequestOptions,
  // a reconnect: carry on in this response
  resume?: Resume,
): Promise<void> => {
  const existingConnection = WebSocketConnections.get(options.requestId);

  if (existingConnection) {
    console.warn('Connection still open to ' + existingConnection.url);
    return;
  }
  // connecting by hand starts afresh, instead of a reconnect that's waiting
  if (!resume) {
    cancelReconnect(options.requestId);
  }
  ClosingOnPurpose.delete(options.requestId);
  const request = await webSocketRequest.getById(options.requestId);
  const responseId = resume?.responseId || generateId('res');
  if (!request) {
    return;
  }

  const responsesDir = path.join(process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData'), 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });

  const flags = resume ? 'a' : 'w';
  const responseBodyPath = resume?.eventLogPath || path.join(responsesDir, uuidV4() + '.response');
  eventLogFileStreams.set(options.requestId, fs.createWriteStream(responseBodyPath, { flags }));
  const timelinePath = resume?.timelinePath || path.join(responsesDir, responseId + '.timeline');
  timelineFileStreams.set(options.requestId, fs.createWriteStream(timelinePath, { flags }));
  if (resume) {
    timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ value: `Reconnecting, attempt ${Reconnects.get(options.requestId)?.attempt ?? 1}`, name: 'Text', timestamp: Date.now() }) + '\n');
  }

  const workspaceMeta = await models.workspaceMeta.getOrCreateByParentId(options.workspaceId);
  // fallback to base environment
  const activeEnvironmentId = workspaceMeta.activeEnvironmentId;
  const activeEnvironment = activeEnvironmentId && await models.environment.getById(activeEnvironmentId);
  const environment = activeEnvironment || await models.environment.getOrCreateForParentId(options.workspaceId);
  guard(environment, 'failed to find environment ' + activeEnvironmentId);
  const responseEnvironmentId = environment ? environment._id : null;

  try {
    if (!options.url) {
      throw new Error('URL is required');
    }
    // a hex or base64 first message that doesn't decode stops here, before connecting
    const initialBytes = options.initialPayload && options.initialPayloadBinary ? payloadBytes(options.initialPayload, options.initialPayloadBinary) : undefined;
    const caCert = await models.caCertificate.findByParentId(options.workspaceId);
    const caCertficatePath = caCert?.disabled === false ? caCert.path : null;
    const caCertificate = await getCaBundle(caCertficatePath, (await models.settings.getOrCreate()).useSystemCertificates);

    const reduceArrayToLowerCaseKeyedDictionary = (acc: { [key: string]: string }, { name, value }: BaseWebSocketRequest['headers'][0]) =>
      ({ ...acc, [name.toLowerCase() || '']: value || '' });
    const headers = options.headers;
    let url = options.url;
    let authCookie = null;
    // the headers auth adds, which a redirect to another host doesn't get
    const authHeaders: string[] = [];
    const wsAuthStrategies = getAuthStrategies(options.authentication).filter(s => !s.disabled);
    for (const auth of wsAuthStrategies) {
      if (auth.type === AUTH_BASIC) {
        const { username, password, useISO88591 } = auth;
        const encoding = useISO88591 ? 'latin1' : 'utf8';
        const h = getBasicAuthHeader(username, password, encoding);
        if (h) {
          headers.push({ ...h, name: auth.headerName || h.name });
          authHeaders.push((auth.headerName || h.name).toLowerCase());
        }
      } else if (auth.type === AUTH_API_KEY) {
        const { key, value, addTo } = auth;
        if (addTo === HEADER) {
          headers.push({ name: auth.headerName || key, value });
          authHeaders.push((auth.headerName || key).toLowerCase());
        } else if (addTo === COOKIE) {
          authCookie = `${key}=${value}`;
        } else if (addTo === QUERY_PARAMS) {
          const qs = buildQueryStringFromParams([{ name: key, value }]);
          url = joinUrlAndQueryString(options.url, qs);
        }
      } else if (auth.type === AUTH_BEARER) {
        const { token, prefix } = auth;
        const h = getBearerAuthHeader(token, prefix);
        if (h) {
          headers.push({ ...h, name: auth.headerName || h.name });
          authHeaders.push((auth.headerName || h.name).toLowerCase());
        }
      }
    }

    const lowerCasedEnabledHeaders = headers
      .filter(({ name, disabled }) => Boolean(name) && !disabled)
      .reduce(reduceArrayToLowerCaseKeyedDictionary, {});
    const settings = await models.settings.getOrCreate();
    const start = performance.now();

    const clientCertificates = await models.clientCertificate.findByParentId(options.workspaceId);
    const filteredClientCertificates = clientCertificates.filter(c => !c.disabled && urlMatchesCertHost(setDefaultProtocol(c.host, 'wss:'), options.url));
    const pemCertificates: string[] = [];
    const pemCertificateKeys: KeyObject[] = [];
    const pfxCertificates: PxfObject[] = [];

    filteredClientCertificates.forEach(clientCertificate => {
      const { passphrase, cert, key, pfx } = clientCertificate;

      if (cert) {
        timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ value: `Adding SSL PEM certificate: ${cert}`, name: 'Text', timestamp: Date.now() }) + '\n');
        pemCertificates.push(fs.readFileSync(cert, 'utf-8'));
      }

      if (key) {
        timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ value: `Adding SSL KEY certificate: ${key}`, name: 'Text', timestamp: Date.now() }) + '\n');
        pemCertificateKeys.push({ pem: fs.readFileSync(key, 'utf-8'), passphrase: passphrase ?? undefined });
      }

      if (pfx) {
        timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ value: `Adding SSL P12 certificate: ${pfx}`, name: 'Text', timestamp: Date.now() }) + '\n');
        pfxCertificates.push({ buf: fs.readFileSync(pfx, 'utf-8'), passphrase: passphrase ?? undefined });
      }
    });

    if (request.settingSendCookies && options.cookieJar.cookies.length) {
      const jar = jarFromCookies(options.cookieJar.cookies);
      const cookieHeader = jar.getCookieStringSync(options.url);
      const cookieHeaderWithAuth = cookieHeader ? `${cookieHeader};${authCookie ?? ''}` : `${authCookie};`;
      if (cookieHeaderWithAuth) {
        lowerCasedEnabledHeaders['cookie'] = cookieHeaderWithAuth;
      }
    }

    const followRedirects = {
      'off': false,
      'on': true,
      'global': settings.followRedirects,
    }[request.settingFollowRedirects] ?? true;
    const socketIo = options.socketIo;
    if (socketIo) {
      url = socketIoUrl(url);
    }
    const subscription = socketIo ? undefined : options.graphqlSubscription;
    const mqtt = socketIo || subscription ? undefined : options.mqtt;
    const protocols = subscription
      ? withGraphqlProtocol(lowerCasedEnabledHeaders['sec-websocket-protocol'])
      : lowerCasedEnabledHeaders['sec-websocket-protocol'] || (mqtt ? MQTT_PROTOCOL : undefined);
    if (subscription) {
      delete lowerCasedEnabledHeaders['sec-websocket-protocol'];
    }
    // a CONNECT tunnel through an HTTP(S) proxy works for ws and wss alike; the
    // TLS options above still apply, inside it
    const proxy = await proxyFor(url, settings);
    if (proxy) {
      timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ value: `Using proxy ${describeProxy(proxy)}`, name: 'Text', timestamp: Date.now() }) + '\n');
    }
    const agent = proxy ? (proxy.startsWith('socks') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy)) : undefined;
    // for an MCP client, no connection to a cloud metadata address, however
    // named or redirected to (network/metadata-hosts.ts)
    const refuseMetadata = metadataGuarded();
    const ws = new WebSocket(url, protocols, {
      agent,
      ...(refuseMetadata ? { lookup: lookupRefusingMetadata } : {}),
      headers: lowerCasedEnabledHeaders,
      ca: caCertificate,
      cert: pemCertificates,
      key: pemCertificateKeys,
      pfx: pfxCertificates,
      rejectUnauthorized: settings.validateSSL,
      followRedirects,
      maxRedirects: settings.maxRedirects > 0 ? settings.maxRedirects : undefined,
    });
    onWebSocketRedirect(ws, url, { refuseMetadata, authHeaders });
    WebSocketConnections.set(options.requestId, ws);
    if (mqtt) {
      MqttSessions.set(options.requestId, new MqttSession(mqtt, data => ws.send(data), (text, direction) => {
        const event: WebSocketMessageEvent = { _id: uuidV4(), requestId: options.requestId, data: text, type: 'message', direction, timestamp: Date.now() };
        eventLogFileStreams.get(options.requestId)?.write(JSON.stringify(event) + '\n');
      }));
    }

    ws.on('upgrade', async incomingMessage => {
      // @ts-expect-error -- private property
      const internalRequestHeader = ws._req._header;
      const { timeline, responseHeaders, statusCode, statusMessage, httpVersion } = parseResponseAndBuildTimeline(url, incomingMessage, internalRequestHeader);
      const responsePatch: Partial<WebSocketResponse> = {
        _id: responseId,
        parentId: request._id,
        environmentId: responseEnvironmentId,
        headers: responseHeaders,
        url: url,
        statusCode,
        statusMessage,
        httpVersion,
        elapsedTime: performance.now() - start,
        timelinePath,
        eventLogPath: responseBodyPath,
        settingSendCookies: request.settingSendCookies,
        settingStoreCookies: request.settingStoreCookies,
      };

      if (!resume) {
        const settings = await models.settings.getOrCreate();
        const res = await models.webSocketResponse.create(responsePatch, settings.maxHistoryResponses);
        models.requestMeta.updateOrCreateByParentId(request._id, { activeResponseId: res._id });
      }

      if (request.settingStoreCookies) {
        const setCookieStrings: string[] = getSetCookieHeaders(responseHeaders).map(h => h.value);
        const totalSetCookies = setCookieStrings.length;
        if (totalSetCookies) {
          const currentUrl = request.url;
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
    });
    ws.on('unexpected-response', async (clientRequest, incomingMessage) => {
      // the server answered with HTTP, not a WebSocket: trying again won't help
      ClosingOnPurpose.add(options.requestId);
      incomingMessage.on('data', chunk => {
        timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ value: chunk.toString(), name: 'DataOut', timestamp: Date.now() }) + '\n');
      });
      // @ts-expect-error -- private property
      const internalRequestHeader = clientRequest._header;
      const { timeline, responseHeaders, statusCode, statusMessage, httpVersion } = parseResponseAndBuildTimeline(url, incomingMessage, internalRequestHeader);
      timeline.map(t => timelineFileStreams.get(options.requestId)?.write(JSON.stringify(t) + '\n'));
      const responsePatch: Partial<WebSocketResponse> = {
        _id: responseId,
        parentId: request._id,
        environmentId: responseEnvironmentId,
        headers: responseHeaders,
        url: url,
        statusCode,
        statusMessage,
        httpVersion,
        elapsedTime: performance.now() - start,
        timelinePath,
        eventLogPath: responseBodyPath,
        settingSendCookies: request.settingSendCookies,
        settingStoreCookies: request.settingStoreCookies,
      };
      if (!resume) {
        const settings = await models.settings.getOrCreate();
        const res = await models.webSocketResponse.create(responsePatch, settings.maxHistoryResponses);
        models.requestMeta.updateOrCreateByParentId(request._id, { activeResponseId: res._id });
      }
      deleteRequestMaps(request._id, `Unexpected response ${incomingMessage.statusCode}`);
      afterDrop(request._id);
    });

    ws.addEventListener('open', () => {
      const openEvent: WebSocketOpenEvent = {
        _id: uuidV4(),
        requestId: options.requestId,
        type: 'open',
        timestamp: Date.now(),
      };

      eventLogFileStreams.get(options.requestId)?.write(JSON.stringify(openEvent) + '\n');
      timelineFileStreams.get(options.requestId)?.write(JSON.stringify({ value: 'WebSocket connection established', name: 'Text', timestamp: Date.now() }) + '\n');
      // from here a drop reconnects, if the request says to; a reconnect doesn't
      // send the first message again. The attempts so far still count until
      // the connection has stayed open a while (afterDrop).
      const earlier = Reconnects.get(options.requestId);
      clearTimeout(earlier?.timer);
      Reconnects.set(options.requestId, {
        options: { ...options, initialPayload: undefined, initialPayloadBinary: undefined },
        resume: { responseId, eventLogPath: responseBodyPath, timelinePath },
        attempt: resume ? earlier?.attempt ?? 0 : 0,
        openedAt: Date.now(),
      });
      broadcastReadyState(options.requestId);

      const mqttSession = MqttSessions.get(options.requestId);
      if (mqttSession) {
        mqttSession.open();
      } else if (subscription) {
        sendPayload(ws, { requestId: options.requestId, payload: connectionInit() });
      } else if (options.initialPayload) {
        sendPayload(ws, { requestId: options.requestId, payload: options.initialPayload, bytes: initialBytes });
      }
    });

    ws.addEventListener('message', ({ data }: MessageEvent) => {
      // MQTT's binary packets go to the log as text, by the session
      const mqttSession = MqttSessions.get(options.requestId);
      if (mqttSession) {
        const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(String(data));
        const refusal = mqttSession.receive(bytes);
        if (refusal) {
          closeOnPurpose(options.requestId, ws, 1000, refusal);
        }
        return;
      }
      const messageEvent: WebSocketMessageEvent = {
        _id: uuidV4(),
        requestId: options.requestId,
        ...loggedData(data),
        type: 'message',
        direction: 'INCOMING',
        timestamp: Date.now(),
      };

      eventLogFileStreams.get(options.requestId)?.write(JSON.stringify(messageEvent) + '\n');

      // the protocols below speak text
      if (bytesOf(data)) {
        return;
      }
      if (socketIo) {
        socketIoReplies(data, socketIo).forEach(payload => sendPayload(ws, { requestId: options.requestId, payload }));
      }
      if (subscription) {
        const { send, done } = graphqlWsReplies(data, subscription);
        send.forEach(payload => sendPayload(ws, { requestId: options.requestId, payload }));
        if (done) {
          closeOnPurpose(options.requestId, ws, 1000, 'Subscription complete');
        }
      }
    });

    ws.addEventListener('close', ({ code, reason, wasClean }) => {
      const closeEvent: WebSocketCloseEvent = {
        _id: uuidV4(),
        requestId: options.requestId,
        code,
        reason,
        type: 'close',
        wasClean,
        timestamp: Date.now(),
      };

      const message = `Closing connection with code ${code}`;
      deleteRequestMaps(request._id, message, closeEvent);
      afterDrop(request._id);
    });

    ws.addEventListener('error', async ({ error, message }: ErrorEvent) => {
      console.error('Error from remote:', error.code, error);

      const errorEvent: WebSocketErrorEvent = {
        _id: uuidV4(),
        requestId: options.requestId,
        message,
        type: 'error',
        error,
        timestamp: Date.now(),
      };

      deleteRequestMaps(request._id, message, errorEvent);
      afterDrop(request._id);
      if (error.code && !resume) {
        createErrorResponse(responseId, request._id, responseEnvironmentId, timelinePath, message || 'Something went wrong');
      }
    });
  } catch (e) {
    console.error('unhandled error:', e);

    deleteRequestMaps(request._id, e.message || 'Something went wrong');
    if (resume) {
      afterDrop(request._id);
    } else {
      createErrorResponse(responseId, request._id, responseEnvironmentId, timelinePath, e.message || 'Something went wrong');
    }
  }
};

// After a connection closes or fails: reconnect if it had opened, the request
// says to, nobody closed it on purpose, and there are attempts left
const afterDrop = async (requestId: string) => {
  const reconnect = Reconnects.get(requestId);
  const onPurpose = ClosingOnPurpose.delete(requestId);
  // a failed connection reports an error and then a close: decide once
  if (reconnect?.timer || reconnect?.deciding) {
    return;
  }
  if (!reconnect || onPurpose) {
    cancelReconnect(requestId);
    broadcastReadyState(requestId);
    return;
  }
  reconnect.deciding = true;
  const request = await webSocketRequest.getById(requestId);
  reconnect.deciding = false;
  // reopened, or closed by hand, while reading the request
  if (Reconnects.get(requestId) !== reconnect || WebSocketConnections.has(requestId)) {
    return;
  }
  const limits = reconnectLimits(request?.reconnect);
  if (reconnect.openedAt && Date.now() - reconnect.openedAt >= STABLE_MS) {
    reconnect.attempt = 0;
  }
  reconnect.openedAt = undefined;
  if (!request || !limits.enabled || reconnect.attempt >= limits.maxAttempts) {
    if (request && limits.enabled) {
      appendLine(reconnect.resume.timelinePath, `Gave up reconnecting after ${reconnect.attempt} attempts`);
    }
    cancelReconnect(requestId);
    broadcastReadyState(requestId);
    return;
  }
  reconnect.attempt += 1;
  appendLine(reconnect.resume.timelinePath, `Reconnecting in ${limits.delayMs / 1000} s`);
  reconnect.timer = setTimeout(() => {
    if (Reconnects.get(requestId) !== reconnect) {
      return;
    }
    reconnect.timer = undefined;
    openWebSocketConnection(null, reconnect.options, reconnect.resume);
  }, limits.delayMs);
  broadcastReadyState(requestId);
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
  const res = await models.webSocketResponse.create(responsePatch, settings.maxHistoryResponses);
  models.requestMeta.updateOrCreateByParentId(requestId, { activeResponseId: res._id });
};

const deleteRequestMaps = async (requestId: string, message: string, event?: WebSocketCloseEvent | WebSocketErrorEvent) => {
  if (event) {
    eventLogFileStreams.get(requestId)?.write(JSON.stringify(event) + '\n');
  }
  MqttSessions.get(requestId)?.stop();
  MqttSessions.delete(requestId);
  eventLogFileStreams.get(requestId)?.end();
  eventLogFileStreams.delete(requestId);
  timelineFileStreams.get(requestId)?.write(JSON.stringify({ value: message, name: 'Text', timestamp: Date.now() }) + '\n');
  timelineFileStreams.get(requestId)?.end();
  timelineFileStreams.delete(requestId);
  WebSocketConnections.delete(requestId);
};

const getWebSocketReadyState = async (
  options: { requestId: string }
): Promise<boolean> => isConnected(options.requestId);

// bytes, when the payload was hex or base64: sent as a binary frame
const sendPayload = async (ws: WebSocket, options: { payload: string; requestId: string; bytes?: Buffer }): Promise<void> => {
  ws.send(options.bytes ?? options.payload, error => {
    // @TODO: We might want to set a status in the WebSocketMessageEvent
    // and update it here based on the error. e.g. status = 'sending' | 'sent' | 'error'
    if (error) {
      console.error(error);
    } else {
      console.log('Message sent');
    }
  });

  const lastMessage: WebSocketMessageEvent = {
    _id: uuidV4(),
    requestId: options.requestId,
    ...(options.bytes ? loggedData(options.bytes) : { data: options.payload }),
    direction: 'OUTGOING',
    type: 'message',
    timestamp: Date.now(),
  };

  eventLogFileStreams.get(options.requestId)?.write(JSON.stringify(lastMessage) + '\n');
  const response = await models.webSocketResponse.getLatestByParentId(options.requestId);
  if (!response) {
    console.error('something went wrong');
    return;
  }
};

const sendWebSocketEvent = async (
  options: { payload: string; requestId: string; mqtt?: MqttPublish; binary?: BinaryEncoding }
): Promise<void> => {
  const ws = WebSocketConnections.get(options.requestId);

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    // waiting to reconnect: there's no connection to send on yet
    if (Reconnects.get(options.requestId)?.timer || ws) {
      throw new Error('Reconnecting: send once the connection is open again');
    }
    console.warn('No websocket found for requestId: ' + options.requestId);
    return;
  }

  // over MQTT, the message is published to the topic
  const mqttSession = MqttSessions.get(options.requestId);
  if (mqttSession) {
    if (!options.mqtt) {
      throw new Error('Choose a topic to publish to');
    }
    mqttSession.publish(options.mqtt, options.payload);
    return;
  }
  sendPayload(ws, { ...options, bytes: options.binary ? payloadBytes(options.payload, options.binary) : undefined });
};

const closeWebSocketConnection = (
  options: { requestId: string }
): void => {
  // also stops a reconnect that's waiting
  cancelReconnect(options.requestId);
  const ws = WebSocketConnections.get(options.requestId);
  if (!ws) {
    broadcastReadyState(options.requestId);
    return;
  }
  // an MQTT client says it's leaving
  MqttSessions.get(options.requestId)?.close();
  closeOnPurpose(options.requestId, ws);
};

const closeAllWebSocketConnections = (): void => {
  [...Reconnects.keys()].forEach(cancelReconnect);
  WebSocketConnections.forEach((ws, requestId) => closeOnPurpose(requestId, ws));
};

const findMany = async (
  options: { responseId: string }
): Promise<WebSocketEvent[]> => {
  const response = await models.webSocketResponse.getById(options.responseId);
  if (!response || !response.eventLogPath) {
    return [];
  }
  return readEventLog<WebSocketEvent>(response.eventLogPath);
};

// what a window polling the log doesn't have yet
const findSince = async (
  options: { responseId: string; known: number }
): Promise<{ total: number; added: WebSocketEvent[] }> => {
  const response = await models.webSocketResponse.getById(options.responseId);
  if (!response || !response.eventLogPath) {
    return { total: 0, added: [] };
  }
  return readEventLogSince<WebSocketEvent>(response.eventLogPath, options.known);
};

export interface WebSocketBridgeAPI {
  open: (options: OpenWebSocketRequestOptions) => void;
  close: typeof closeWebSocketConnection;
  closeAll: typeof closeAllWebSocketConnections;
  readyState: {
    getCurrent: typeof getWebSocketReadyState;
  };
  event: {
    findMany: typeof findMany;
    findSince: typeof findSince;
    send: typeof sendWebSocketEvent;
  };
}
// the same connections, for an MCP client (main/mcp/tools/websockets.ts); the
// window sees them as it sees its own
export const webSockets = {
  open: (options: OpenWebSocketRequestOptions) => openWebSocketConnection(null, options),
  send: sendWebSocketEvent,
  close: (requestId: string) => closeWebSocketConnection({ requestId }),
  isOpen: (requestId: string) => getWebSocketReadyState({ requestId }),
  events: async (requestId: string) => {
    const response = await models.webSocketResponse.getLatestByParentId(requestId);
    return response ? findMany({ responseId: response._id }) : [];
  },
};

export const registerWebSocketHandlers = () => {
  ipcMain.handle('webSocket.open', openWebSocketConnection);
  ipcMain.handle('webSocket.event.send', (_, options: Parameters<typeof sendWebSocketEvent>[0]) => sendWebSocketEvent(options));
  ipcMain.on('webSocket.close', (_, options: Parameters<typeof closeWebSocketConnection>[0]) => closeWebSocketConnection(options));
  ipcMain.on('webSocket.closeAll', closeAllWebSocketConnections);
  ipcMain.handle('webSocket.readyState', (_, options: Parameters<typeof getWebSocketReadyState>[0]) => getWebSocketReadyState(options));
  ipcMain.handle('webSocket.event.findMany', (_, options: Parameters<typeof findMany>[0]) => findMany(options));
  ipcMain.handle('webSocket.event.findSince', (_, options: Parameters<typeof findSince>[0]) => findSince(options));
};

electron.app.on('window-all-closed', closeAllWebSocketConnections);
