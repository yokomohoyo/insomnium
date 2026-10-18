// GraphQL subscriptions over a WebSocket, with the graphql-transport-ws
// protocol (github.com/enisdenjo/graphql-ws, PROTOCOL.md), which Apollo,
// Hasura, Yoga and others speak: connection_init once the socket opens, then a
// subscribe on connection_ack. The server's next, error and complete messages
// show in the event log like any other; a ping gets its pong.
export const GRAPHQL_WS_PROTOCOL = 'graphql-transport-ws';
export const SUBSCRIPTION_ID = '1';

export interface GraphqlSubscription {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

export const connectionInit = () => JSON.stringify({ type: 'connection_init', payload: {} });

// the subprotocols to ask for: the header's, with GraphQL's
export const withGraphqlProtocol = (protocols?: string) => {
  const asked = (protocols || '').split(',').map(protocol => protocol.trim()).filter(Boolean);
  return asked.includes(GRAPHQL_WS_PROTOCOL) ? asked : [...asked, GRAPHQL_WS_PROTOCOL];
};

// what a message from the server asks of the client: messages to send back,
// and whether the subscription is over
export function graphqlWsReplies(data: unknown, subscription: GraphqlSubscription): { send: string[]; done: boolean } {
  let message: { type?: string; id?: string } | null = null;
  try {
    message = typeof data === 'string' ? JSON.parse(data) : null;
  } catch {
    // not one of the protocol's messages
  }
  switch (message?.type) {
    case 'connection_ack':
      return {
        send: [JSON.stringify({
          id: SUBSCRIPTION_ID,
          type: 'subscribe',
          payload: {
            query: subscription.query,
            ...(subscription.variables ? { variables: subscription.variables } : {}),
            ...(subscription.operationName ? { operationName: subscription.operationName } : {}),
          },
        })],
        done: false,
      };
    case 'ping':
      return { send: [JSON.stringify({ type: 'pong' })], done: false };
    case 'complete':
      return { send: [], done: message.id === SUBSCRIPTION_ID };
    default:
      return { send: [], done: false };
  }
}

// a request's subscription, as the app keeps it, ready to send: its variables
// are JSON text there
export function subscriptionToSend(saved?: { enabled?: boolean; query?: string; variables?: string; operationName?: string }): GraphqlSubscription | undefined {
  if (!saved?.enabled || !saved.query?.trim()) {
    return undefined;
  }
  let variables: Record<string, unknown> | undefined;
  if (saved.variables?.trim()) {
    const parsed = JSON.parse(saved.variables);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The subscription\'s variables have to be a JSON object');
    }
    variables = parsed;
  }
  return { query: saved.query, ...(variables ? { variables } : {}), ...(saved.operationName ? { operationName: saved.operationName } : {}) };
}
