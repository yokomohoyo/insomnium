/**
 * @jest-environment node
 */
import { credentials, makeGenericClientConstructor, Metadata, Server, ServerCredentials } from '@grpc/grpc-js';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { forwardStatusAndMetadata } from '../../ipc/grpc';
import { withStatus } from '../../mcp/tools/grpc';
import { plainMetadata } from '../grpc-metadata';

// a real call, to a real server
jest.unmock('@grpc/grpc-js');

const serialize = (value: unknown) => Buffer.from(JSON.stringify(value));
const deserialize = (buffer: Buffer) => JSON.parse(buffer.toString());

describe('gRPC response metadata', () => {
  let server: Server;
  let url: string;
  let client: any;

  // an echo service that sends headers (one binary) and trailers
  beforeEach(async () => {
    server = new Server();
    server.addService({
      Echo: { path: '/test.Echo/Echo', requestStream: false, responseStream: false, requestSerialize: serialize, requestDeserialize: deserialize, responseSerialize: serialize, responseDeserialize: deserialize },
    }, {
      Echo: (call: any, callback: any) => {
        const headers = new Metadata();
        headers.set('x-request-id', 'abc');
        headers.set('trace-bin', Buffer.from([1, 2, 3]));
        call.sendMetadata(headers);
        const trailers = new Metadata();
        trailers.set('x-checksum', 'ok');
        callback(null, call.request, trailers);
      },
    });
    const port = await new Promise<number>((resolve, reject) => server.bindAsync('localhost:0', ServerCredentials.createInsecure(), (err, port) => err ? reject(err) : resolve(port)));
    url = `localhost:${port}`;
    // @ts-expect-error -- as in ipc/grpc.ts
    const Client = makeGenericClientConstructor({});
    client = new Client(url, credentials.createInsecure());
  });

  afterEach(() => {
    client.close();
    server.forceShutdown();
  });

  const echo = (callback: (err: unknown, response: unknown) => void) =>
    client.makeUnaryRequest('/test.Echo/Echo', serialize, deserialize, { hello: 'metadata' }, new Metadata(), { deadline: Date.now() + 5000 }, callback);

  it('reach the window as plain data: the headers, then the status with its trailers', async () => {
    const replies: unknown[][] = [];
    await new Promise<void>(resolve => {
      forwardStatusAndMetadata({ reply: (...args: unknown[]) => {
        replies.push(args);
        if (args[0] === 'grpc.status') {
          resolve();
        }
      } }, echo(() => {}), 'req_1');
    });

    expect(replies[0]).toEqual(['grpc.metadata', 'req_1', expect.objectContaining({ 'x-request-id': ['abc'], 'trace-bin': ['AQID'] })]);
    expect(replies[1]).toEqual(['grpc.status', 'req_1', expect.objectContaining({ code: 0, metadata: expect.objectContaining({ 'x-checksum': ['ok'] }) })]);
  });

  it('come back from an MCP send, with the response', async () => {
    const result = await new Promise(resolve => {
      const outcome = withStatus(resolve);
      outcome.watch(echo(outcome.callback));
    });

    expect(result).toEqual({
      ok: true,
      response: { hello: 'metadata' },
      headers: expect.objectContaining({ 'x-request-id': ['abc'], 'trace-bin': ['AQID'] }),
      trailers: expect.objectContaining({ 'x-checksum': ['ok'] }),
    });
  });

  it('keep binary values as base64, and nothing for no metadata', () => {
    const metadata = new Metadata();
    metadata.add('a', '1');
    metadata.add('a', '2');
    metadata.add('key-bin', Buffer.from('hi'));
    expect(plainMetadata(metadata)).toEqual({ a: ['1', '2'], 'key-bin': ['aGk='] });
    expect(plainMetadata(undefined)).toEqual({});
  });
});
