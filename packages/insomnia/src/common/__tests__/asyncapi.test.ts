import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';

import { parseApiSpec } from '../api-specs';
import { asyncApiOutline } from '../asyncapi';

const v3 = `asyncapi: 3.0.0
info:
  title: Orders
  version: 1.2.0
  description: Order events
servers:
  production:
    host: broker.example.com:9092
    protocol: kafka
channels:
  orderPlaced:
    address: orders/placed
    description: An order was placed
    messages:
      OrderPlaced:
        $ref: '#/components/messages/OrderPlaced'
  orderShipped:
    address: orders/{orderId}/shipped
    messages:
      shipped:
        payload: { type: object }
operations:
  publishOrder:
    action: send
    summary: Tell the warehouse
    channel: { $ref: '#/channels/orderPlaced' }
    messages: [{ $ref: '#/channels/orderPlaced/messages/OrderPlaced' }]
  onShipped:
    action: receive
    channel: { $ref: '#/channels/orderShipped' }
components:
  messages:
    OrderPlaced:
      contentType: application/json
      payload: { $ref: '#/components/schemas/Order' }
  schemas:
    Order:
      type: object
      properties: { id: { type: string } }
`;

const v2 = `asyncapi: 2.6.0
info: { title: Lights, version: 1.0.0 }
servers:
  mosquitto: { url: mqtt://test.mosquitto.org, protocol: mqtt }
channels:
  light/measured:
    subscribe:
      operationId: onLightMeasured
      message:
        oneOf:
          - { name: lumens, payload: { type: integer } }
          - $ref: '#/components/messages/dim'
    publish:
      message: { payload: { type: string } }
components:
  messages:
    dim: { summary: Dimmed, payload: { type: boolean } }
`;

describe('asyncApiOutline()', () => {
  it('outlines a 3.x document: servers, channels, their operations and messages', () => {
    expect(asyncApiOutline(YAML.parse(v3))).toEqual({
      version: '3.0.0',
      title: 'Orders',
      infoVersion: '1.2.0',
      description: 'Order events',
      servers: [{ name: 'production', url: 'broker.example.com:9092', protocol: 'kafka' }],
      channels: [{
        name: 'orderPlaced',
        address: 'orders/placed',
        description: 'An order was placed',
        operations: [{
          id: 'publishOrder',
          action: 'send',
          summary: 'Tell the warehouse',
          messages: [{ name: 'OrderPlaced', contentType: 'application/json', payload: { type: 'object', properties: { id: { type: 'string' } } } }],
        }],
        messages: [{ name: 'OrderPlaced', contentType: 'application/json', payload: { type: 'object', properties: { id: { type: 'string' } } } }],
      }, {
        name: 'orderShipped',
        address: 'orders/{orderId}/shipped',
        // an operation without messages has its channel's
        operations: [{ id: 'onShipped', action: 'receive', messages: [{ name: 'shipped', payload: { type: 'object' } }] }],
        messages: [{ name: 'shipped', payload: { type: 'object' } }],
      }],
    });
  });

  it('outlines a 2.x document, with publish and subscribe on each channel', () => {
    const outline = asyncApiOutline(YAML.parse(v2));

    expect(outline.servers).toEqual([{ name: 'mosquitto', url: 'mqtt://test.mosquitto.org', protocol: 'mqtt' }]);
    expect(outline.channels).toEqual([{
      name: 'light/measured',
      address: 'light/measured',
      operations: [
        { id: 'publish light/measured', action: 'publish', messages: [{ name: 'light/measured', payload: { type: 'string' } }] },
        { id: 'onLightMeasured', action: 'subscribe', messages: [{ name: 'lumens', payload: { type: 'integer' } }, { name: 'dim', summary: 'Dimmed', payload: { type: 'boolean' } }] },
      ],
      messages: [],
    }]);
  });

  it("leaves a ref it can't follow, and survives one that loops", () => {
    const outline = asyncApiOutline({
      asyncapi: '2.6.0',
      channels: {
        a: { subscribe: { message: { $ref: './messages.yaml#/Order' } } },
        b: { publish: { message: { $ref: '#/components/messages/loop' } } },
      },
      components: { messages: { loop: { $ref: '#/components/messages/loop' } } },
    });

    expect(outline.title).toBe('Untitled');
    expect(outline.channels[0].operations[0].messages).toEqual([{ name: 'Order' }]);
    expect(outline.channels[1].operations[0].messages).toEqual([{ name: 'loop' }]);
  });
});

describe('parseApiSpec()', () => {
  it('knows an AsyncAPI document', () => {
    expect(parseApiSpec(v3)).toMatchObject({ format: 'asyncapi', formatVersion: '3.0.0' });
  });
});
