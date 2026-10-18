/**
 * @jest-environment node
 */
import { ChannelCredentials, makeGenericClientConstructor, Metadata, Server, ServerCredentials, ServiceError, status } from '@grpc/grpc-js';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { AUTH_BEARER, AUTH_DIGEST } from '../../../common/constants';
import * as models from '../../../models';
import { assertGrpcAuthSupported, getGrpcCredentials } from '../grpc-credentials';

// real TLS, against a real server
jest.unmock('@grpc/grpc-js');

// A test-only CA, with a server certificate for localhost and a client certificate
const fixture = (name: string) => path.join(__dirname, 'fixtures/grpc-tls', name);
const serialize = (value: unknown) => Buffer.from(JSON.stringify(value));
const deserialize = (buffer: Buffer) => JSON.parse(buffer.toString());

let server: Server | undefined;

// an echo service over TLS, optionally requiring a client certificate
const startServer = async (requireClientCertificate = false) => {
  server = new Server();
  server.addService({
    Echo: { path: '/test.Echo/Echo', requestStream: false, responseStream: false, requestSerialize: serialize, requestDeserialize: deserialize, responseSerialize: serialize, responseDeserialize: deserialize },
  }, {
    Echo: (call: any, callback: any) => callback(null, call.request),
  });
  const credentials = ServerCredentials.createSsl(
    fs.readFileSync(fixture('ca.pem')),
    [{ private_key: fs.readFileSync(fixture('server-key.pem')), cert_chain: fs.readFileSync(fixture('server.pem')) }],
    requireClientCertificate,
  );
  const port = await new Promise<number>((resolve, reject) => server!.bindAsync('localhost:0', credentials, (err, port) => err ? reject(err) : resolve(port)));
  return `localhost:${port}`;
};

const echo = (url: string, channelCredentials: ChannelCredentials) => new Promise<unknown>((resolve, reject) => {
  // @ts-expect-error -- as in ipc/grpc.ts
  const Client = makeGenericClientConstructor({});
  const client = new Client(url, channelCredentials);
  client.makeUnaryRequest('/test.Echo/Echo', serialize, deserialize, { hello: 'tls' }, new Metadata(), { deadline: Date.now() + 5000 }, (err: ServiceError | null, response: unknown) => {
    client.close();
    return err ? reject(err) : resolve(response);
  });
});

describe('getGrpcCredentials()', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    workspaceId = (await models.workspace.create())._id;
  });

  afterEach(() => {
    server?.forceShutdown();
    server = undefined;
  });

  const trustTestCa = () => models.caCertificate.create({ parentId: workspaceId, path: fixture('ca.pem'), disabled: false });

  it('trusts the workspace CA, as HTTP requests do', async () => {
    const url = await startServer();
    await trustTestCa();

    await expect(echo(url, await getGrpcCredentials(url, true, workspaceId))).resolves.toEqual({ hello: 'tls' });
  });

  it('refuses a server signed by a CA it does not trust', async () => {
    const url = await startServer();

    await expect(echo(url, await getGrpcCredentials(url, true, workspaceId))).rejects.toMatchObject({ code: status.UNAVAILABLE });
  });

  it('connects anyway with Validate certificates off', async () => {
    const url = await startServer();
    await models.settings.patch({ validateSSL: false });

    await expect(echo(url, await getGrpcCredentials(url, true, workspaceId))).resolves.toEqual({ hello: 'tls' });
  });

  // a host without a port means 443, as for HTTP requests
  it('sends the workspace client certificate for the host', async () => {
    const url = await startServer(true);
    await trustTestCa();
    const certificate = await models.clientCertificate.create({ parentId: workspaceId, host: 'localhost:*', cert: fixture('client.pem'), key: fixture('client-key.pem') });

    await expect(echo(url, await getGrpcCredentials(url, true, workspaceId))).resolves.toEqual({ hello: 'tls' });

    await models.clientCertificate.update(certificate, { host: 'example.com:*' });
    await expect(echo(url, await getGrpcCredentials(url, true, workspaceId))).rejects.toMatchObject({ code: status.UNAVAILABLE });
  });

  it('uses no TLS when the url does not ask for it', async () => {
    expect((await getGrpcCredentials('localhost:50051', false, workspaceId))._isSecure()).toBe(false);
  });
});

describe('assertGrpcAuthSupported()', () => {
  it('refuses auth that only libcurl applies, which would leave the call unauthenticated', () => {
    expect(() => assertGrpcAuthSupported([{ type: AUTH_DIGEST, username: 'u', password: 'p' }])).toThrow("gRPC requests can't use Digest auth");
  });

  it('allows header auth, and ignores a disabled strategy', () => {
    expect(() => assertGrpcAuthSupported([{ type: AUTH_BEARER, token: 't' }, { type: AUTH_DIGEST, disabled: true }])).not.toThrow();
    expect(() => assertGrpcAuthSupported([])).not.toThrow();
  });
});
