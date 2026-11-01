import type { ClientRequest } from 'http';
import type WebSocket from 'ws';

import { isMetadataHost } from '../../network/metadata-hosts';

// What a WebSocket handshake does on each redirect. ws drops the Authorization
// and Cookie headers itself on a change of host (or from wss to ws) only while
// nothing listens for 'redirect', so this listener does it too; and, for an
// MCP client, it refuses a redirect to a cloud metadata address.
export const onWebSocketRedirect = (ws: Pick<WebSocket, 'on'>, originalUrl: string, { refuseMetadata }: { refuseMetadata: boolean }) => {
  const original = new URL(originalUrl);
  ws.on('redirect', (url: string, request: ClientRequest) => {
    const next = new URL(url);
    if (refuseMetadata && isMetadataHost(next.hostname)) {
      request.destroy(new Error(`Refusing to connect to ${next.hostname}: cloud metadata addresses are blocked`));
      return;
    }
    const sameHost = next.host === original.host;
    if (!sameHost || (original.protocol === 'wss:' && next.protocol !== 'wss:')) {
      request.removeHeader('authorization');
      request.removeHeader('cookie');
    }
    if (!sameHost && request.getHeader('host') !== undefined && request.getHeader('host') !== next.host) {
      request.setHeader('host', next.host);
    }
  });
};
