/**
 * @jest-environment node
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { connectPacket, describePacket, MqttSession, parseSubscriptions, publishPacket, readPackets, subscribePacket } from '../mqtt';

const hex = (buffer: Buffer) => buffer.toString('hex');

describe('MQTT packets', () => {
  it('writes a CONNECT as MQTT 3.1.1 has it', () => {
    expect(hex(connectPacket({ clientId: 'c1', keepalive: 60, subscriptions: [] }))).toBe('100e00044d5154540402003c0002' + Buffer.from('c1').toString('hex'));
    // with a user name and password: flags 0xc2
    expect(hex(connectPacket({ clientId: 'c', username: 'u', password: 'p', keepalive: 0, subscriptions: [] }))).toBe('1013' + '00044d515454' + '04c2' + '0000' + '000163' + '000175' + '000170');
    // a password needs a user name
    expect(hex(connectPacket({ clientId: 'c', password: 'p', keepalive: 0, subscriptions: [] })).slice(18, 20)).toBe('02');
  });

  it('writes SUBSCRIBE and PUBLISH, with a remaining length past 127', () => {
    expect(hex(subscribePacket(1, [{ topic: 'a/#', qos: 1 }]))).toBe('82080001' + '0003612f23' + '01');
    expect(hex(publishPacket({ topic: 't', qos: 0, retain: true }, Buffer.from('hi')))).toBe('3105000174' + '6869');
    const long = publishPacket({ topic: 't', qos: 1, retain: false }, Buffer.alloc(200, 0x61), 9);
    expect(hex(long.subarray(0, 8))).toBe('32cd0100017400' + '09');
    expect(() => publishPacket({ topic: 'a/+', qos: 0, retain: false }, Buffer.alloc(0))).toThrow('without wildcards');
  });

  it('reads the packets that came in, keeping a partial one for later', () => {
    const publish = publishPacket({ topic: 'sensors/1', qos: 1, retain: false }, Buffer.from('21.5'), 7);
    const stream = Buffer.concat([Buffer.from('20020000', 'hex'), Buffer.from('900400010180', 'hex'), publish, Buffer.from('d000', 'hex')]);

    const first = readPackets(stream.subarray(0, 12));
    expect(first.packets).toEqual([
      { type: 'connack', sessionPresent: false, returnCode: 0 },
      { type: 'suback', packetId: 1, granted: [1, 0x80] },
    ]);
    const second = readPackets(Buffer.concat([first.rest, stream.subarray(12)]));
    expect(second.packets).toEqual([
      { type: 'publish', topic: 'sensors/1', qos: 1, retain: false, packetId: 7, payload: Buffer.from('21.5') },
      { type: 'pingresp' },
    ]);
    expect(second.rest.length).toBe(0);
    expect(second.packets.map(describePacket)).toEqual(['sensors/1: 21.5', 'PINGRESP']);
    expect(first.packets.map(describePacket)).toEqual(['CONNACK: connected', 'SUBACK: QoS 1, refused']);
  });

  it('reads subscriptions a line each, with their QoS', () => {
    expect(parseSubscriptions('sensors/+/temperature 1\n\n  alerts/# \nmy topic 0')).toEqual([
      { topic: 'sensors/+/temperature', qos: 1 },
      { topic: 'alerts/#', qos: 0 },
      { topic: 'my topic', qos: 0 },
    ]);
  });
});

describe('MqttSession', () => {
  afterEach(() => jest.useRealTimers());

  const session = (options = {}) => {
    const sent: Buffer[] = [];
    const logged: [string, string][] = [];
    const mqtt = new MqttSession({ clientId: 'c1', keepalive: 30, subscriptions: [{ topic: 'a/#', qos: 1 }], ...options }, data => sent.push(data), (text, direction) => logged.push([direction, text]));
    return { mqtt, sent, logged };
  };

  it('connects, subscribes once accepted, keeps alive, and acknowledges QoS 1 deliveries', () => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    const { mqtt, sent, logged } = session();

    mqtt.open();
    expect(hex(sent[0]).slice(0, 2)).toBe('10');
    expect(mqtt.receive(Buffer.from('20020000', 'hex'))).toBeUndefined();
    expect(hex(sent[1]).slice(0, 2)).toBe('82');
    mqtt.receive(publishPacket({ topic: 'a/b', qos: 1, retain: true }, Buffer.from('on'), 42));
    expect(hex(sent[2])).toBe('4002002a');
    jest.advanceTimersByTime(30_000);
    expect(hex(sent[3])).toBe('c000');

    mqtt.publish({ topic: 'a/c', qos: 0, retain: false }, 'hello');
    mqtt.close();
    expect(hex(sent[sent.length - 1])).toBe('e000');
    expect(logged).toEqual([
      ['OUTGOING', 'CONNECT as c1'],
      ['INCOMING', 'CONNACK: connected'],
      ['OUTGOING', 'SUBSCRIBE a/# (QoS 1)'],
      ['INCOMING', 'a/b (retained): on'],
      ['OUTGOING', 'a/c: hello'],
    ]);
  });

  it('says why the broker refused the connection', () => {
    const { mqtt, sent } = session({ username: 'me', password: 'wrong' });
    mqtt.open();

    expect(mqtt.receive(Buffer.from('20020004', 'hex'))).toBe('CONNACK: refused, the user name or password was wrong');
    expect(sent).toHaveLength(1);
  });
});
