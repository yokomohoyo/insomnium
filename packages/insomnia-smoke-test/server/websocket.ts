import { IncomingMessage, Server } from 'http';
import { Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Starts an echo WebSocket server that receives messages from a client and echoes them back.
 */
export function startWebSocketServer(server: Server) {
  const wsServer = new WebSocketServer({ noServer: true, handleProtocols: protocols => protocols.has('graphql-transport-ws') ? 'graphql-transport-ws' : protocols.has('mqtt') ? 'mqtt' : 'chat' });

  server.on('upgrade', (request, socket, head) => {
    upgrade(wsServer, request, socket, head);
  });

  wsServer.on('connection', handleConnection);

  wsServer.on('headers', (headers, request) => {
    if (request.url === '/cookies') {
      headers.push('Set-Cookie: insomnia-websocket-test-cookie=foo');
    }
  });
}

// a GraphQL subscription over graphql-transport-ws: two pets, then complete
const handleGraphqlConnection = (ws: WebSocket) => {
  ws.on('message', message => {
    const { type, id, payload } = JSON.parse(message.toString());
    if (type === 'connection_init') {
      ws.send(JSON.stringify({ type: 'connection_ack' }));
    } else if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    } else if (type === 'subscribe') {
      const species = payload.variables?.species || 'dog';
      ws.send(JSON.stringify({ id, type: 'next', payload: { data: { petAdded: { name: 'Rex', species } } } }));
      ws.send(JSON.stringify({ id, type: 'next', payload: { data: { petAdded: { name: 'Fido', species } } } }));
      ws.send(JSON.stringify({ id, type: 'complete' }));
    }
  });
};

// a Socket.IO server's side of the WebSocket transport: open, the namespace's
// connect (with a welcome carrying the auth it got), a heartbeat, and each
// event back
const handleSocketIoConnection = (ws: WebSocket) => {
  ws.send('0{"sid":"smoke","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}');
  ws.on('message', message => {
    const text = message.toString();
    const body = text.slice(2);
    const prefix = body.startsWith('/') ? body.slice(0, body.indexOf(',') + 1) : '';
    const data = body.slice(prefix.length);
    if (text.startsWith('40')) {
      ws.send(`40${prefix}{"sid":"smoke-socket"}`);
      ws.send(`42${prefix}${JSON.stringify(['welcome', data ? JSON.parse(data) : null])}`);
      ws.send('2');
    } else if (text.startsWith('42')) {
      const [event, ...args] = JSON.parse(data);
      ws.send(`42${prefix}${JSON.stringify([`${event} back`, ...args])}`);
    }
  });
};

// an MQTT broker, just enough for the tests: it takes user "smoke" with
// password "secret", grants the subscriptions, delivers a retained message at
// QoS 1 (and says when it's acknowledged), and sends each publish back
const mqttString = (text: string) => Buffer.concat([Buffer.from([text.length >> 8, text.length & 0xff]), Buffer.from(text)]);
const mqttPublish = (topic: string, payload: string, packetId?: number) => {
  const body = Buffer.concat([mqttString(topic), packetId ? Buffer.from([packetId >> 8, packetId & 0xff]) : Buffer.alloc(0), Buffer.from(payload)]);
  return Buffer.concat([Buffer.from([packetId ? 0x32 : 0x30, body.length]), body]);
};
const handleMqttConnection = (ws: WebSocket) => {
  ws.on('message', (message: Buffer) => {
    const type = message[0] >> 4;
    // remaining lengths here are under 128, so the body starts at 2
    const body = message.subarray(2);
    if (type === 1) {
      const flags = body[7];
      let offset = 10;
      const read = () => {
        const length = body.readUInt16BE(offset);
        const text = body.subarray(offset + 2, offset + 2 + length).toString();
        offset += 2 + length;
        return text;
      };
      read();
      const username = flags & 0x80 ? read() : '';
      const password = flags & 0x40 ? read() : '';
      ws.send(Buffer.from([0x20, 2, 0, username === 'smoke' && password === 'secret' ? 0 : 4]));
    } else if (type === 8) {
      const granted: number[] = [];
      for (let offset = 2; offset < body.length;) {
        const length = body.readUInt16BE(offset);
        offset += 2 + length;
        granted.push(body[offset++]);
      }
      ws.send(Buffer.from([0x90, 2 + granted.length, body[0], body[1], ...granted]));
      ws.send(mqttPublish('smoke/hello', 'retained hi', 7));
    } else if (type === 4) {
      ws.send(mqttPublish('smoke/acked', `puback ${body.readUInt16BE(0)}`));
    } else if (type === 3) {
      const length = body.readUInt16BE(0);
      const topic = body.subarray(2, 2 + length).toString();
      const qos = (message[0] >> 1) & 3;
      const payload = body.subarray(2 + length + (qos ? 2 : 0)).toString();
      ws.send(mqttPublish(topic, `echo ${payload}`));
    } else if (type === 12) {
      ws.send(Buffer.from([0xd0, 0]));
    } else if (type === 14) {
      ws.close();
    }
  });
};

const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
  console.log('WebSocket connection was opened');
  console.log('Upgrade headers:', req.headers);
  if (req.url?.startsWith('/socket.io/')) {
    handleSocketIoConnection(ws);
    return;
  }
  if (ws.protocol === 'graphql-transport-ws') {
    handleGraphqlConnection(ws);
    return;
  }
  if (ws.protocol === 'mqtt') {
    handleMqttConnection(ws);
    return;
  }

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      ws.send(message);
      return;
    }

    // Returns binary data
    if (req.url === '/binary') {
      ws.send(Buffer.alloc(0));
      ws.send(Buffer.from('test'));
      ws.send(message);
      ws.send(message.toString());
      return;
    }

    if (message.toString() === 'close') {
      ws.close(1003, 'Invalid message type');
    }
    ws.send(message.toString());
  });

  ws.on('close', () => {
    console.log('WebSocket connection was closed');
  });
};
const redirectOnSuccess = (socket: Socket) => {
  socket.end('HTTP/1.1 302 Found\r\nLocation: ws://localhost:4010/\r\n\r\n');
  return;
};
const return401withBody = (socket: Socket) => {
  socket.end(`HTTP/1.1 401 Unauthorized

  <!doctype html>
  <html>
  <body>
  <div>
    <h1>401 Unauthorized</h1>
  </div>
  </body>
  </html>`);
  return;
};
const upgrade = (wss: WebSocketServer, request: IncomingMessage, socket: Socket, head: Buffer) => {
  if (request.url === '/redirect') {
    return redirectOnSuccess(socket);
  }
  if (request.url === '/bearer') {
    if (request.headers.authorization !== 'Bearer insomnia-cool-token-!!!1112113243111') {
      return401withBody(socket);
      return;
    }
    return redirectOnSuccess(socket);
  }
  if (request.url === '/delay') {
    const delaySec = Number.parseInt(request.headers.duration as string || '5');
    setTimeout(function() {
      redirectOnSuccess(socket);
    }, delaySec * 1000);
    return ;
  }
  if (request.url === '/basic-auth') {
    // login with user:password
    if (request.headers.authorization !== 'Basic dXNlcjpwYXNzd29yZA==') {
      return401withBody(socket);
      return;
    }
    return redirectOnSuccess(socket);
  }
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
};
