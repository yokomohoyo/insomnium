// Socket.IO (v3 and v4) over a WebSocket request: the Engine.IO and
// Socket.IO packets a socket.io-client sends, so a Socket.IO server can be
// tried without a client library. The connection goes straight to the
// WebSocket transport (no long-polling first), which Socket.IO servers allow
// by default; binary attachments aren't supported.
//
// Engine.IO packets: 0 open, 2 ping, 3 pong, 4 message. A message's Socket.IO
// packet: 0 connect, 1 disconnect, 2 event, 3 ack, 4 connect error, then the
// namespace ("/chat,") when it isn't "/", an ack id, and the JSON data.

export interface SocketIoOptions {
  // "/" or "/admin"
  namespace?: string;
  // sent with the connect, as Socket.IO's `auth`
  auth?: Record<string, unknown>;
}

const namespacePrefix = (namespace?: string) => namespace && namespace !== '/' ? `${namespace.startsWith('/') ? namespace : `/${namespace}`},` : '';

// a URL as the server takes the WebSocket transport: ws(s), the /socket.io/
// path unless one is given, and EIO=4&transport=websocket
export function socketIoUrl(url: string) {
  const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
  parsed.protocol = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (parsed.pathname === '/' || parsed.pathname === '') {
    parsed.pathname = '/socket.io/';
  }
  parsed.searchParams.set('EIO', '4');
  parsed.searchParams.set('transport', 'websocket');
  return parsed.toString();
}

// an event to send: its name, and its arguments
export function socketIoEvent(event: string, args: unknown[], namespace?: string) {
  return `42${namespacePrefix(namespace)}${JSON.stringify([event, ...args])}`;
}

// the event's arguments, from the editor's JSON: an array is the arguments, anything else is one
export function socketIoArgs(text: string): unknown[] {
  if (!text.trim()) {
    return [];
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// what a frame from the server asks of the client: frames to send back
export function socketIoReplies(data: unknown, options: SocketIoOptions): string[] {
  if (typeof data !== 'string' || !data) {
    return [];
  }
  switch (data[0]) {
    // the transport is open: connect to the namespace
    case '0':
      return [`40${namespacePrefix(options.namespace)}${options.auth ? JSON.stringify(options.auth) : ''}`];
    // a heartbeat
    case '2':
      return ['3'];
    default:
      return [];
  }
}
