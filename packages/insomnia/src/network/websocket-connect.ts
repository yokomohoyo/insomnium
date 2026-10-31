import { getRenderContext, render, RENDER_PURPOSE_SEND } from '../common/render';
import { subscriptionToSend } from '../main/network/graphql-ws';
import { type MqttOptions, parseSubscriptions } from '../main/network/mqtt';
import type { SocketIoOptions } from '../main/network/socket-io';
import * as models from '../models';
import type { CookieJar } from '../models/cookie-jar';
import type { RequestAuthentication, RequestHeader } from '../models/request';
import type { WebSocketRequest } from '../models/websocket-request';
import { addSegValuesToUrl, buildQueryStringFromParams, joinUrlAndQueryString } from '../utils/url/querystring';

// What a WebSocket request connects with, rendered with an environment: its
// URL with the query string, headers, auth and cookies, and how it speaks
// (a GraphQL subscription, Socket.IO, or MQTT). The URL bar's Connect and an
// MCP client's connect_websocket both build it here.

export interface WebSocketConnection {
  url: string;
  headers: RequestHeader[];
  authentication: RequestAuthentication;
  cookieJar: CookieJar;
  suppressUserAgent: boolean;
  graphqlSubscription?: ReturnType<typeof subscriptionToSend>;
  socketIo?: SocketIoOptions;
  mqtt?: MqttOptions;
}

// A protocol setting that can't be used (Socket.IO's auth isn't a JSON
// object, a subscription's query doesn't parse); `protocol` names it
export class WebSocketSettingsError extends Error {
  protocol: 'Socket.IO' | 'GraphQL Subscription';

  constructor(protocol: WebSocketSettingsError['protocol'], message: string) {
    super(message);
    this.name = 'WebSocketSettingsError';
    this.protocol = protocol;
  }
}

// throws the render error (`type: 'render'`) when a template can't render
export async function renderWebSocketConnection(request: WebSocketRequest, environmentId: string, workspaceId: string): Promise<WebSocketConnection> {
  const workspaceCookieJar = await models.cookieJar.getOrCreateForParentId(workspaceId);
  const renderContext = await getRenderContext({ request, environmentId, purpose: RENDER_PURPOSE_SEND });
  const rendered = await render({
    url: request.url,
    headers: request.headers,
    authentication: request.authentication,
    parameters: request.parameters.filter(parameter => !parameter.disabled),
    workspaceCookieJar,
    graphqlSubscription: request.graphqlSubscription,
    socketIo: request.socketIo,
    mqtt: request.mqtt,
  }, renderContext) as any;
  // MQTT's connect: a new client ID when none is given
  const mqtt: MqttOptions | undefined = rendered.mqtt?.enabled && !rendered.socketIo?.enabled ? {
    clientId: rendered.mqtt.clientId?.trim() || `insomnium-${Math.random().toString(36).slice(2, 10)}`,
    username: rendered.mqtt.username || undefined,
    password: rendered.mqtt.password || undefined,
    keepalive: rendered.mqtt.keepalive ?? 30,
    subscriptions: parseSubscriptions(rendered.mqtt.subscriptions || ''),
  } : undefined;
  let graphqlSubscription;
  let socketIo: SocketIoOptions | undefined;
  const protocol = rendered.socketIo?.enabled ? 'Socket.IO' : 'GraphQL Subscription';
  try {
    graphqlSubscription = subscriptionToSend(rendered.graphqlSubscription);
    if (rendered.socketIo?.enabled) {
      const auth = rendered.socketIo.auth?.trim() ? JSON.parse(rendered.socketIo.auth) : undefined;
      if (auth !== undefined && (!auth || typeof auth !== 'object' || Array.isArray(auth))) {
        throw new Error("Socket.IO's auth has to be a JSON object");
      }
      socketIo = { namespace: rendered.socketIo.namespace?.trim() || '/', ...(auth ? { auth } : {}) };
    }
  } catch (err) {
    throw new WebSocketSettingsError(protocol, err instanceof Error ? err.message : String(err));
  }
  return {
    url: addSegValuesToUrl(joinUrlAndQueryString(rendered.url, buildQueryStringFromParams(rendered.parameters)), rendered.segmentParams),
    headers: rendered.headers,
    authentication: rendered.authentication,
    cookieJar: rendered.workspaceCookieJar,
    suppressUserAgent: rendered.suppressUserAgent,
    graphqlSubscription,
    socketIo,
    mqtt,
  };
}
