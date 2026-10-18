import { describe, expect, it } from '@jest/globals';

import { connectionInit, GRAPHQL_WS_PROTOCOL, graphqlWsReplies, subscriptionToSend, withGraphqlProtocol } from '../graphql-ws';

const subscription = { query: 'subscription { petAdded { name } }', variables: { species: 'cat' } };

describe('graphql-transport-ws', () => {
  it('asks for the protocol, with any the request asks for too', () => {
    expect(withGraphqlProtocol()).toEqual([GRAPHQL_WS_PROTOCOL]);
    expect(withGraphqlProtocol('v1, chat')).toEqual(['v1', 'chat', GRAPHQL_WS_PROTOCOL]);
    expect(withGraphqlProtocol(GRAPHQL_WS_PROTOCOL)).toEqual([GRAPHQL_WS_PROTOCOL]);
  });

  it('starts with connection_init, and subscribes once acknowledged', () => {
    expect(JSON.parse(connectionInit())).toEqual({ type: 'connection_init', payload: {} });

    const { send, done } = graphqlWsReplies(JSON.stringify({ type: 'connection_ack' }), { ...subscription, operationName: 'PetAdded' });

    expect(done).toBe(false);
    expect(send.map(message => JSON.parse(message))).toEqual([{
      id: '1',
      type: 'subscribe',
      payload: { query: 'subscription { petAdded { name } }', variables: { species: 'cat' }, operationName: 'PetAdded' },
    }]);
  });

  it('answers a ping, lets events through, and is done when its subscription completes', () => {
    expect(graphqlWsReplies(JSON.stringify({ type: 'ping' }), subscription)).toEqual({ send: [JSON.stringify({ type: 'pong' })], done: false });
    expect(graphqlWsReplies(JSON.stringify({ id: '1', type: 'next', payload: { data: {} } }), subscription)).toEqual({ send: [], done: false });
    expect(graphqlWsReplies(JSON.stringify({ id: '1', type: 'complete' }), subscription)).toEqual({ send: [], done: true });
    expect(graphqlWsReplies(JSON.stringify({ id: '2', type: 'complete' }), subscription).done).toBe(false);
    expect(graphqlWsReplies('not json', subscription)).toEqual({ send: [], done: false });
    expect(graphqlWsReplies(Buffer.from('x'), subscription)).toEqual({ send: [], done: false });
  });

  it('makes the saved subscription ready to send, when it is on', () => {
    expect(subscriptionToSend(undefined)).toBeUndefined();
    expect(subscriptionToSend({ enabled: false, query: 'subscription { a }', variables: '' })).toBeUndefined();
    expect(subscriptionToSend({ enabled: true, query: '  ', variables: '' })).toBeUndefined();
    expect(subscriptionToSend({ enabled: true, query: 'subscription { a }', variables: '' })).toEqual({ query: 'subscription { a }' });
    expect(subscriptionToSend({ enabled: true, query: 'subscription { a }', variables: '{ "id": 1 }' })).toEqual({ query: 'subscription { a }', variables: { id: 1 } });
    expect(() => subscriptionToSend({ enabled: true, query: 'subscription { a }', variables: '[1]' })).toThrow('JSON object');
    expect(() => subscriptionToSend({ enabled: true, query: 'subscription { a }', variables: '{ nope' })).toThrow();
  });
});
