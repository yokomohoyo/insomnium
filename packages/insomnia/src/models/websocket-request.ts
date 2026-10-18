import { database } from '../common/database';
import type { BaseModel } from '.';
import { RequestAuthentication, RequestHeader, RequestParameter, RequestSegment } from './request';

export const name = 'WebSocket Request';

export const type = 'WebSocketRequest';

export const prefix = 'ws-req';

export const canDuplicate = true;

export const canSync = true;

// kept only when set, so requests without them sync as before
export const optionalKeys = ['savedMessages', 'graphqlSubscription', 'socketIo', 'mqtt'];

export interface WebSocketSavedMessage {
  name: string;
  value: string;
}

export interface BaseWebSocketRequest {
  name: string;
  description: string;
  url: string;
  metaSortKey: number;
  headers: RequestHeader[];
  authentication: RequestAuthentication;
  parameters: RequestParameter[];
  settingEncodeUrl: boolean;
  settingStoreCookies: boolean;
  settingSendCookies: boolean;
  settingFollowRedirects: 'global' | 'on' | 'off';
  segmentParams: RequestSegment[];
  // messages kept to send again; the editor's draft is a WebSocketPayload
  savedMessages?: WebSocketSavedMessage[];
  // a GraphQL subscription to start once connected (graphql-transport-ws:
  // main/network/graphql-ws.ts); its variables are JSON text
  graphqlSubscription?: {
    enabled: boolean;
    query: string;
    variables: string;
  };
  // speak Socket.IO over the connection (main/network/socket-io.ts): its
  // namespace, its auth as JSON text, and the event the editor's message is sent as
  socketIo?: {
    enabled: boolean;
    namespace: string;
    auth: string;
    event: string;
  };
  // speak MQTT 3.1.1 over the connection (main/network/mqtt.ts): who to
  // connect as, the topics to subscribe to (a line each, "topic qos"), and the
  // topic the editor's message is published to
  mqtt?: {
    enabled: boolean;
    clientId: string;
    username: string;
    password: string;
    keepalive: number;
    subscriptions: string;
    topic: string;
    qos: 0 | 1;
    retain: boolean;
  };
}

export type WebSocketRequest = BaseModel & BaseWebSocketRequest & { type: typeof type };

export const isWebSocketRequest = (model: Pick<BaseModel, 'type'>): model is WebSocketRequest => (
  model.type === type
);

export const isWebSocketRequestId = (id: string | null) => (
  id?.startsWith(`${prefix}_`)
);

export const init = (): BaseWebSocketRequest => ({
  name: 'New WebSocket Request',
  url: '',
  metaSortKey: -1 * Date.now(),
  headers: [],
  authentication: [],
  parameters: [],
  settingEncodeUrl: true,
  settingStoreCookies: true,
  settingSendCookies: true,
  settingFollowRedirects: 'global',
  description: '',
  segmentParams: [],
});

export const migrate = (doc: WebSocketRequest) => {
  const auth = (doc as any).authentication;
  if (auth && !Array.isArray(auth)) {
    (doc as any).authentication = Object.keys(auth).length === 0 ? [] : [auth];
  } else if (!auth) {
    (doc as any).authentication = [];
  }
  return doc;
};

export const create = (patch: Partial<WebSocketRequest> = {}) => {
  if (!patch.parentId) {
    throw new Error(`New WebSocketRequest missing \`parentId\`: ${JSON.stringify(patch)}`);
  }

  return database.docCreate<WebSocketRequest>(type, patch);
};

export const remove = (obj: WebSocketRequest) => database.remove(obj);

export const update = (
  obj: WebSocketRequest,
  patch: Partial<WebSocketRequest> = {}
) => database.docUpdate(obj, patch);

// This is duplicated (lol) from models/request.js
export async function duplicate(request: WebSocketRequest, patch: Partial<WebSocketRequest> = {}) {
  // Only set name and "(Copy)" if the patch does
  // not define it and the request itself has a name.
  // Otherwise leave it blank so the request URL can
  // fill it in automatically.
  if (!patch.name && request.name) {
    patch.name = `${request.name} (Copy)`;
  }

  // Get sort key of next request
  const q = {
    metaSortKey: {
      $gt: request.metaSortKey,
    },
  };
  // @ts-expect-error -- Database TSCONVERSION
  const [nextRequest] = await database.find<WebSocketRequest>(type, q, {
    metaSortKey: 1,
  });
  const nextSortKey = nextRequest ? nextRequest.metaSortKey : request.metaSortKey + 100;
  // Calculate new sort key
  const sortKeyIncrement = (nextSortKey - request.metaSortKey) / 2;
  const metaSortKey = request.metaSortKey + sortKeyIncrement;
  // Inherit the original name (incl. '' for unnamed) instead of the module
  // display-name constant ('WebSocketRequest').
  return database.duplicate<WebSocketRequest>(request, {
    metaSortKey,
    ...patch,
  });
}

export const getById = (_id: string) => database.getWhere<WebSocketRequest>(type, { _id });

export const findByParentId = (parentId: string) => database.find<WebSocketRequest>(type, { parentId });

export const all = () => database.all<WebSocketRequest>(type);
