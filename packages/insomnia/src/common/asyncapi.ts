// An AsyncAPI document (2.x or 3.x) as the design view previews it: its
// servers, and its channels with the operations on them and their messages.
// Swagger UI shows OpenAPI only. $refs within the document are followed; refs
// to other files or URLs are left as they are.

export interface AsyncApiMessage {
  name: string;
  summary?: string;
  contentType?: string;
  payload?: unknown;
}

export interface AsyncApiOperation {
  id: string;
  // 3.x says send or receive; 2.x said publish or subscribe
  action: string;
  summary?: string;
  messages: AsyncApiMessage[];
}

export interface AsyncApiChannel {
  name: string;
  address: string;
  description?: string;
  operations: AsyncApiOperation[];
  // its messages, when no operation names them
  messages: AsyncApiMessage[];
}

export interface AsyncApiOutline {
  version: string;
  title: string;
  infoVersion: string;
  description?: string;
  servers: { name: string; url: string; protocol: string }[];
  channels: AsyncApiChannel[];
}

type Doc = Record<string, any>;

const isObject = (value: unknown): value is Doc => !!value && typeof value === 'object' && !Array.isArray(value);

// a local $ref (#/components/messages/Order), followed a few levels deep
const resolver = (root: Doc) => {
  const resolve = (value: unknown, depth = 0): any => {
    if (!isObject(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/') || depth > 8) {
      return value;
    }
    const target = value.$ref.slice(2).split('/').reduce<any>(
      (node, part) => (isObject(node) ? node[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined),
      root,
    );
    return target === undefined ? value : resolve(target, depth + 1);
  };
  return resolve;
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);

export function asyncApiOutline(doc: Doc): AsyncApiOutline {
  const resolve = resolver(doc);
  const version = String(doc.asyncapi || '');
  const isV3 = /^3\./.test(version);

  const message = (name: string, raw: unknown): AsyncApiMessage => {
    const value = resolve(raw);
    const named = isObject(raw) && typeof raw.$ref === 'string' ? raw.$ref.split('/').pop() : undefined;
    return {
      name: text(value?.name) || text(value?.title) || named || name,
      ...(text(value?.summary) ? { summary: value.summary } : {}),
      ...(text(value?.contentType) ? { contentType: value.contentType } : {}),
      ...(value?.payload !== undefined ? { payload: resolve(value.payload) } : {}),
    };
  };
  // 2.x: a message, or oneOf several
  const messagesOf = (raw: unknown, fallback: string): AsyncApiMessage[] => {
    const value = resolve(raw);
    if (!isObject(value)) {
      return [];
    }
    return Array.isArray(value.oneOf) ? value.oneOf.map((one: unknown, index: number) => message(`${fallback} ${index + 1}`, one)) : [message(fallback, raw)];
  };

  const servers = Object.entries(isObject(doc.servers) ? doc.servers : {}).map(([name, raw]) => {
    const server = resolve(raw) || {};
    const url = isV3 ? `${server.host || ''}${server.pathname || ''}` : String(server.url || '');
    return { name, url, protocol: String(server.protocol || '') };
  });

  const channels: AsyncApiChannel[] = Object.entries(isObject(doc.channels) ? doc.channels : {}).map(([name, raw]) => {
    const channel = resolve(raw) || {};
    const operations: AsyncApiOperation[] = [];
    if (!isV3) {
      for (const action of ['publish', 'subscribe']) {
        const operation = resolve(channel[action]);
        if (isObject(operation)) {
          operations.push({
            id: text(operation.operationId) || `${action} ${name}`,
            action,
            ...(text(operation.summary) ? { summary: operation.summary } : {}),
            messages: messagesOf(operation.message, name),
          });
        }
      }
    }
    const ownMessages = isV3 && isObject(channel.messages)
      ? Object.entries(channel.messages).map(([messageName, value]) => message(messageName, value))
      : [];
    return {
      name,
      address: isV3 ? String(channel.address ?? name) : name,
      ...(text(channel.description) ? { description: channel.description } : {}),
      operations,
      messages: ownMessages,
    };
  });

  // 3.x operations sit apart from their channels, which they point to
  if (isV3) {
    for (const [id, raw] of Object.entries(isObject(doc.operations) ? doc.operations : {})) {
      const operation = resolve(raw);
      if (!isObject(operation)) {
        continue;
      }
      const ref = isObject(operation.channel) && typeof operation.channel.$ref === 'string' ? operation.channel.$ref : '';
      const channelName = ref.startsWith('#/channels/') ? ref.slice('#/channels/'.length).replace(/~1/g, '/').replace(/~0/g, '~') : '';
      const channel = channels.find(candidate => candidate.name === channelName);
      if (!channel) {
        continue;
      }
      const named = Array.isArray(operation.messages) ? operation.messages.map((value: unknown, index: number) => message(`${id} ${index + 1}`, value)) : [];
      channel.operations.push({
        id,
        action: String(operation.action || ''),
        ...(text(operation.summary) ? { summary: operation.summary } : {}),
        messages: named.length ? named : channel.messages,
      });
    }
  }

  const info = isObject(doc.info) ? doc.info : {};
  return {
    version,
    title: text(info.title) || 'Untitled',
    infoVersion: String(info.version || ''),
    ...(text(info.description) ? { description: info.description } : {}),
    servers,
    channels,
  };
}
