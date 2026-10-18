import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import * as networkModule from '../../network';
import { getOAuth2Token } from '../get-token';
import { REDACTED, redactBody, redactForm, redactStoredTokenResponses, redactTimeline, redactTokenResponse } from '../redact';

// the token request goes nowhere: it's answered with this body
jest.mock('../../network', () => ({
  fetchRequestData: jest.fn(),
  tryToInterpolateRequest: jest.fn(),
  tryToTransformRequestWithPlugins: jest.fn(),
  sendCurlAndWriteTimeline: jest.fn(),
  responseTransform: jest.fn(),
}));

const TOKENS = '{"access_token":"at-123","token_type":"Bearer","expires_in":3600,"refresh_token":"rt-456","id_token":"it-789","scope":"read"}';

describe('a token request, as kept', () => {
  it('has the tokens of its response replaced, and the rest as it came', () => {
    expect(JSON.parse(redactBody(TOKENS))).toEqual({
      access_token: REDACTED, token_type: 'Bearer', expires_in: 3600, refresh_token: REDACTED, id_token: REDACTED, scope: 'read',
    });
    expect(redactBody('access_token=gho_abc&scope=repo&token_type=bearer')).toBe(`access_token=${REDACTED}&scope=repo&token_type=bearer`);
    expect(redactBody('{"error":"invalid_grant","error_description":"expired"}')).toBe('{"error":"invalid_grant","error_description":"expired"}');
    expect(redactBody('<html>Bad gateway</html>')).toBe('<html>Bad gateway</html>');
  });

  it('has the secrets of the form it sent replaced', () => {
    expect(redactForm('grant_type=authorization_code&code=abc&redirect_uri=http%3A%2F%2Flocalhost&code_verifier=v1&client_id=app&client_secret=s3cr3t'))
      .toBe(`grant_type=authorization_code&code=${REDACTED}&redirect_uri=http%3A%2F%2Flocalhost&code_verifier=${REDACTED}&client_id=app&client_secret=${REDACTED}`);
    expect(redactForm('grant_type=password&username=kim&password=hunter2')).toBe(`grant_type=password&username=kim&password=${REDACTED}`);
    expect(redactForm('grant_type=refresh_token&refresh_token=rt-1')).toBe(`grant_type=refresh_token&refresh_token=${REDACTED}`);
    expect(redactForm(`client_assertion_type=urn&client_assertion=eyJ.x.y`)).toBe(`client_assertion_type=urn&client_assertion=${REDACTED}`);
  });

  it("has the client's credentials taken out of its headers, and leaves the rest of its timeline", () => {
    const timeline = [
      { name: 'Text', value: 'Preparing request to https://auth.example.com/token', timestamp: 1 },
      { name: 'HeaderOut', value: 'POST /token HTTP/1.1\r\nHost: auth.example.com\r\nAuthorization: Basic YXBwOnMzY3IzdA==\r\nAccept: */*\r\n\r\n', timestamp: 2 },
      { name: 'DataOut', value: 'grant_type=client_credentials&client_secret=s3cr3t', timestamp: 3 },
      { name: 'HeaderIn', value: 'HTTP/1.1 200 OK\r\n', timestamp: 4 },
    ] as const;

    expect(redactTimeline([...timeline])).toEqual([
      timeline[0],
      { ...timeline[1], value: `POST /token HTTP/1.1\r\nHost: auth.example.com\r\nAuthorization: Basic ${REDACTED}\r\nAccept: */*\r\n\r\n` },
      { ...timeline[2], value: `grant_type=client_credentials&client_secret=${REDACTED}` },
      timeline[3],
    ]);
  });
});

describe('the files of a token request', () => {
  let dir: string;
  const file = (name: string, content: string | Buffer) => {
    const filepath = path.join(dir, name);
    fs.writeFileSync(filepath, content);
    return filepath;
  };
  const timeline = JSON.stringify([{ name: 'DataOut', value: 'grant_type=refresh_token&refresh_token=rt-1', timestamp: 1 }]);

  beforeEach(async () => {
    await globalBeforeEach();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-token-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('are rewritten without the secrets, zipped ones too, and left alone when there are none', async () => {
    const bodyPath = file('a.response', TOKENS);
    const timelinePath = file('a.timeline', timeline);
    const zipped = file('b.response', zlib.gzipSync(TOKENS));
    const plain = file('c.response', '{"error":"invalid_client"}');
    const before = fs.statSync(plain).mtimeMs;

    await redactTokenResponse({ bodyPath, timelinePath, bodyCompression: null });
    await redactTokenResponse({ bodyPath: zipped, timelinePath: '', bodyCompression: 'zip' });
    await redactTokenResponse({ bodyPath: plain, timelinePath: '', bodyCompression: null });

    expect(fs.readFileSync(bodyPath, 'utf8')).not.toMatch(/at-123|rt-456|it-789/);
    expect(JSON.parse(fs.readFileSync(timelinePath, 'utf8'))[0].value).toBe(`grant_type=refresh_token&refresh_token=${REDACTED}`);
    expect(zlib.gunzipSync(fs.readFileSync(zipped)).toString()).not.toMatch(/at-123/);
    expect(fs.statSync(plain).mtimeMs).toBe(before);
  });

  it('kept from before are redacted at startup: those of requests with an OAuth 2 token, and no others', async () => {
    await models.oAuth2Token.create({ parentId: 'req_1', accessToken: 'at-123' });
    const tokenBody = file('token.response', TOKENS);
    // (a response without a bodyCompression is taken as zipped, which it isn't)
    await models.response.create({ parentId: 'req_1.other', bodyPath: tokenBody, timelinePath: file('token.timeline', timeline), statusCode: 200 });
    // the request's own response, with an access_token of its API's own
    const ownBody = file('own.response', '{"access_token":"part of the API"}');
    await models.response.create({ parentId: 'req_1', bodyPath: ownBody, statusCode: 200 });

    await redactStoredTokenResponses();

    expect(fs.readFileSync(tokenBody, 'utf8')).not.toMatch(/at-123/);
    expect(fs.readFileSync(ownBody, 'utf8')).toBe('{"access_token":"part of the API"}');
  });

  it("aren't kept with the tokens of a new one, which go to the token", async () => {
    const network = networkModule as unknown as Record<string, jest.Mock<any>>;
    const workspace = await models.workspace.create({ name: 'Auth' });
    const request = await models.request.create({ parentId: workspace._id });
    network.fetchRequestData.mockResolvedValue({ request, environment: { _id: 'env_1' }, settings: {}, clientCertificates: [], caCert: null, activeEnvironmentId: null });
    network.tryToInterpolateRequest.mockImplementation(async (request: unknown) => ({ request, context: {} }));
    network.tryToTransformRequestWithPlugins.mockImplementation(async ({ request }: { request: unknown }) => request);
    network.sendCurlAndWriteTimeline.mockImplementation(async (sent: { _id: string }) => ({
      parentId: sent._id,
      statusCode: 200,
      bodyPath: file('new.response', TOKENS),
      timelinePath: file('new.timeline', JSON.stringify([{ name: 'DataOut', value: 'grant_type=client_credentials&client_id=app&client_secret=s3cr3t', timestamp: 1 }])),
    }));
    // as responseTransform leaves a response
    network.responseTransform.mockImplementation(async (patch: object) => ({ ...patch, bodyCompression: null }));

    const token = await getOAuth2Token(request._id, { type: 'oauth2', grantType: 'client_credentials', accessTokenUrl: 'https://auth.example.com/token', clientId: 'app', clientSecret: 's3cr3t', credentialsInBody: true } as any);

    expect(token).toMatchObject({ accessToken: 'at-123', refreshToken: 'rt-456', identityToken: 'it-789' });
    expect(fs.readFileSync(path.join(dir, 'new.response'), 'utf8')).not.toMatch(/at-123|rt-456|it-789/);
    expect(fs.readFileSync(path.join(dir, 'new.timeline'), 'utf8')).not.toMatch(/s3cr3t/);
  });
});
