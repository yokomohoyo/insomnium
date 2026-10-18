// MQTT 3.1.1 over a WebSocket request: the packets an MQTT client sends, so a
// broker's WebSocket listener (Mosquitto's, HiveMQ's, EMQX's) can be tried
// without a client library. It connects, subscribes to the topics given,
// publishes the message editor's text to a topic at QoS 0 or 1, answers QoS 1
// deliveries, and keeps the connection alive. The event log shows each packet
// as text: a delivery as "topic: payload".

export interface MqttSubscription {
  topic: string;
  qos: 0 | 1;
}

export interface MqttOptions {
  clientId: string;
  username?: string;
  password?: string;
  // seconds between pings; 0 for none
  keepalive: number;
  subscriptions: MqttSubscription[];
}

export interface MqttPublish {
  topic: string;
  qos: 0 | 1;
  retain: boolean;
}

// MQTT's own WebSocket subprotocol
export const MQTT_PROTOCOL = 'mqtt';

const u16 = (value: number) => Buffer.from([(value >> 8) & 0xff, value & 0xff]);
const string = (text: string) => {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > 0xffff) {
    throw new Error('An MQTT string can be at most 65,535 bytes');
  }
  return Buffer.concat([u16(bytes.length), bytes]);
};
const remainingLength = (length: number) => {
  if (length > 268_435_455) {
    throw new Error('An MQTT packet can be at most 256 MB');
  }
  const bytes: number[] = [];
  do {
    let digit = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) {
      digit |= 0x80;
    }
    bytes.push(digit);
  } while (length > 0);
  return Buffer.from(bytes);
};
const packet = (header: number, body: Buffer) => Buffer.concat([Buffer.from([header]), remainingLength(body.length), body]);

export function connectPacket({ clientId, username, password, keepalive }: MqttOptions) {
  // a clean session; a password only with a user name, as 3.1.1 requires
  const flags = 0x02 | (username ? 0x80 : 0) | (username && password ? 0x40 : 0);
  return packet(0x10, Buffer.concat([
    string('MQTT'),
    Buffer.from([4, flags]),
    u16(Math.max(0, Math.min(0xffff, Math.round(keepalive)))),
    string(clientId),
    ...(username ? [string(username)] : []),
    ...(username && password ? [string(password)] : []),
  ]));
}

export const subscribePacket = (packetId: number, subscriptions: MqttSubscription[]) =>
  packet(0x82, Buffer.concat([u16(packetId), ...subscriptions.map(({ topic, qos }) => Buffer.concat([string(topic), Buffer.from([qos])]))]));

export function publishPacket({ topic, qos, retain }: MqttPublish, payload: Buffer, packetId?: number) {
  if (!topic || /[+#]/.test(topic)) {
    throw new Error('Publish to a topic without wildcards (+ and #)');
  }
  return packet(0x30 | (qos << 1) | (retain ? 1 : 0), Buffer.concat([string(topic), qos ? u16(packetId ?? 1) : Buffer.alloc(0), payload]));
}

export const pubackPacket = (packetId: number) => packet(0x40, u16(packetId));
export const pingreqPacket = () => Buffer.from([0xc0, 0]);
export const disconnectPacket = () => Buffer.from([0xe0, 0]);

export type MqttPacket =
  | { type: 'connack'; sessionPresent: boolean; returnCode: number }
  | { type: 'publish'; topic: string; payload: Buffer; qos: number; retain: boolean; packetId?: number }
  | { type: 'puback'; packetId: number }
  | { type: 'suback'; packetId: number; granted: number[] }
  | { type: 'unsuback'; packetId: number }
  | { type: 'pingresp' }
  | { type: 'other'; code: number };

// The whole packets at the start of what's been received, and what's left of
// a packet still arriving
export function readPackets(buffer: Buffer): { packets: MqttPacket[]; rest: Buffer } {
  const packets: MqttPacket[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    let length = 0;
    let multiplier = 1;
    let index = offset + 1;
    let complete = false;
    for (let count = 0; count < 4 && index < buffer.length; count++, index++) {
      length += (buffer[index] & 0x7f) * multiplier;
      multiplier *= 128;
      if ((buffer[index] & 0x80) === 0) {
        complete = true;
        index++;
        break;
      }
    }
    if (!complete || index + length > buffer.length) {
      break;
    }
    const header = buffer[offset];
    const body = buffer.subarray(index, index + length);
    const type = header >> 4;
    if (type === 2) {
      packets.push({ type: 'connack', sessionPresent: (body[0] & 1) === 1, returnCode: body[1] });
    } else if (type === 3) {
      const qos = (header >> 1) & 3;
      const topicLength = body.readUInt16BE(0);
      const topic = body.subarray(2, 2 + topicLength).toString('utf8');
      const packetId = qos ? body.readUInt16BE(2 + topicLength) : undefined;
      packets.push({ type: 'publish', topic, qos, retain: (header & 1) === 1, payload: body.subarray(2 + topicLength + (qos ? 2 : 0)), ...(packetId !== undefined ? { packetId } : {}) });
    } else if (type === 4) {
      packets.push({ type: 'puback', packetId: body.readUInt16BE(0) });
    } else if (type === 9) {
      packets.push({ type: 'suback', packetId: body.readUInt16BE(0), granted: [...body.subarray(2)] });
    } else if (type === 11) {
      packets.push({ type: 'unsuback', packetId: body.readUInt16BE(0) });
    } else if (type === 13) {
      packets.push({ type: 'pingresp' });
    } else {
      packets.push({ type: 'other', code: type });
    }
    offset = index + length;
  }
  return { packets, rest: buffer.subarray(offset) };
}

const REFUSALS: Record<number, string> = {
  1: 'the broker does not take MQTT 3.1.1',
  2: 'the client ID was rejected',
  3: 'the server is unavailable',
  4: 'the user name or password was wrong',
  5: 'not authorized',
};

// a payload as text, or as hex when it isn't UTF-8
const payloadText = (payload: Buffer) => {
  const text = payload.toString('utf8');
  return Buffer.from(text, 'utf8').equals(payload) ? text : `0x${payload.toString('hex')}`;
};

export function describePacket(packet: MqttPacket): string {
  switch (packet.type) {
    case 'connack':
      return packet.returnCode === 0 ? 'CONNACK: connected' : `CONNACK: refused, ${REFUSALS[packet.returnCode] || `code ${packet.returnCode}`}`;
    case 'publish':
      return `${packet.topic}${packet.retain ? ' (retained)' : ''}: ${payloadText(packet.payload)}`;
    case 'suback':
      return `SUBACK: ${packet.granted.map(code => (code === 0x80 ? 'refused' : `QoS ${code}`)).join(', ')}`;
    case 'puback':
      return `PUBACK ${packet.packetId}`;
    case 'unsuback':
      return `UNSUBACK ${packet.packetId}`;
    case 'pingresp':
      return 'PINGRESP';
    default:
      return `MQTT packet type ${packet.code}`;
  }
}

// "sensors/+/temperature 1": a topic a line, with its QoS after it (0 when left out)
export function parseSubscriptions(text: string): MqttSubscription[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = /^(.*?)\s+([01])$/.exec(line);
    return match ? { topic: match[1], qos: Number(match[2]) as 0 | 1 } : { topic: line, qos: 0 };
  });
}

// A connection's MQTT side: what it sends, and what the event log shows
export class MqttSession {
  private nextPacketId = 1;
  private pending = Buffer.alloc(0);
  private ping?: NodeJS.Timeout;

  constructor(
    readonly options: MqttOptions,
    private readonly send: (data: Buffer) => void,
    private readonly log: (text: string, direction: 'INCOMING' | 'OUTGOING') => void,
  ) {}

  private packetId() {
    const id = this.nextPacketId;
    this.nextPacketId = id >= 0xffff ? 1 : id + 1;
    return id;
  }

  open() {
    this.send(connectPacket(this.options));
    this.log(`CONNECT as ${this.options.clientId}${this.options.username ? `, user ${this.options.username}` : ''}`, 'OUTGOING');
  }

  // what came in; returns why to close, when the broker refused the connection
  receive(data: Buffer): string | undefined {
    const { packets, rest } = readPackets(Buffer.concat([this.pending, data]));
    this.pending = rest;
    let refusal: string | undefined;
    for (const received of packets) {
      this.log(describePacket(received), 'INCOMING');
      if (received.type === 'connack') {
        if (received.returnCode !== 0) {
          refusal = describePacket(received);
          continue;
        }
        if (this.options.subscriptions.length) {
          this.send(subscribePacket(this.packetId(), this.options.subscriptions));
          this.log(`SUBSCRIBE ${this.options.subscriptions.map(({ topic, qos }) => `${topic} (QoS ${qos})`).join(', ')}`, 'OUTGOING');
        }
        if (this.options.keepalive > 0) {
          this.ping = setInterval(() => this.send(pingreqPacket()), this.options.keepalive * 1000);
        }
      } else if (received.type === 'publish' && received.qos === 1 && received.packetId !== undefined) {
        this.send(pubackPacket(received.packetId));
      }
    }
    return refusal;
  }

  publish(target: MqttPublish, text: string) {
    this.send(publishPacket(target, Buffer.from(text, 'utf8'), target.qos ? this.packetId() : undefined));
    this.log(`${target.topic}${target.retain ? ' (retained)' : ''}: ${text}`, 'OUTGOING');
  }

  close() {
    clearInterval(this.ping);
    this.send(disconnectPacket());
  }

  stop() {
    clearInterval(this.ping);
  }
}
