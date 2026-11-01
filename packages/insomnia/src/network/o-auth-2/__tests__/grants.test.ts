import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'crypto';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import * as networkModule from '../../network';
import { GRANT_TYPE_DEVICE_CODE, GRANT_TYPE_JWT_BEARER, GRANT_TYPE_TOKEN_EXCHANGE } from '../constants';
import { DeviceAuthorization, pollForToken, readDeviceAuthorization, setDeviceCodeUi } from '../device-code';
import { getOAuth2Token } from '../get-token';

// token requests go nowhere: a fake provider answers them
jest.mock('../../network', () => ({
  fetchRequestData: jest.fn(),
  tryToInterpolateRequest: jest.fn(),
  tryToTransformRequestWithPlugins: jest.fn(),
  sendCurlAndWriteTimeline: jest.fn(),
  responseTransform: jest.fn(),
}));

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

const TOKENS = '{"access_token":"at-123","token_type":"Bearer","expires_in":3600}';

describe('the newer grants', () => {
  let dir: string;
  // each token request: where it went, its form and its headers
  let sent: { url: string; form: Record<string, string>; headers: Record<string, string> }[];
  let answer: (url: string, form: Record<string, string>) => { status: number; body: string };
  let requestId: string;
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grants-'));
    sent = [];
    answer = () => ({ status: 200, body: TOKENS });
    const network = networkModule as unknown as Record<string, jest.Mock<any>>;
    const workspace = await models.workspace.create({ name: 'Auth' });
    const request = await models.request.create({ parentId: workspace._id });
    requestId = request._id;
    workspaceId = workspace._id;
    network.fetchRequestData.mockResolvedValue({ request, workspace, environment: { _id: 'env_1' }, settings: {}, clientCertificates: [], caCert: null, activeEnvironmentId: null });
    network.tryToInterpolateRequest.mockImplementation(async (request: unknown) => ({ request, context: {} }));
    network.tryToTransformRequestWithPlugins.mockImplementation(async ({ request }: { request: unknown }) => request);
    network.sendCurlAndWriteTimeline.mockImplementation(async (request: any) => {
      const form = Object.fromEntries(request.body.params.map(({ name, value }: { name: string; value: string }) => [name, value]));
      const headers = Object.fromEntries(request.headers.map(({ name, value }: { name: string; value: string }) => [name.toLowerCase(), value]));
      sent.push({ url: request.url, form, headers });
      const { status, body } = answer(request.url, form);
      const bodyPath = path.join(dir, `${sent.length}.response`);
      fs.writeFileSync(bodyPath, body);
      const timelinePath = path.join(dir, `${sent.length}.timeline`);
      fs.writeFileSync(timelinePath, '[]');
      return { parentId: request._id, statusCode: status, bodyPath, timelinePath };
    });
    network.responseTransform.mockImplementation(async (patch: object) => ({ ...patch, bodyCompression: null }));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('JWT bearer: signs an assertion from the issuer, for the token endpoint, and sends no client secret it lacks', async () => {
    const token = await getOAuth2Token(requestId, {
      type: 'oauth2',
      grantType: GRANT_TYPE_JWT_BEARER,
      accessTokenUrl: 'https://oauth2.example.com/token',
      privateKey,
      assertionIssuer: 'robot@project.example.com',
      assertionSubject: 'alice@example.com',
      scope: 'read write',
    });

    expect(token).toMatchObject({ accessToken: 'at-123' });
    expect(sent).toHaveLength(1);
    expect(sent[0].form).toMatchObject({ grant_type: GRANT_TYPE_JWT_BEARER, scope: 'read write' });
    expect(sent[0].headers.authorization).toBeUndefined();
    expect(claimsOf(sent[0].form.assertion)).toMatchObject({
      iss: 'robot@project.example.com', sub: 'alice@example.com', aud: 'https://oauth2.example.com/token', scope: 'read write',
    });
  });

  it('JWT bearer: sends an assertion as given, and the client as it says', async () => {
    await getOAuth2Token(requestId, {
      type: 'oauth2',
      grantType: GRANT_TYPE_JWT_BEARER,
      accessTokenUrl: 'https://auth.example.com/token',
      assertion: 'eyJ.given.jwt',
      clientId: 'app',
      clientSecret: 's3cr3t',
      // left on from another grant: the key isn't for the client here
      usePrivateKeyJwt: true,
      privateKey,
    });

    expect(sent[0].form).toEqual({ grant_type: GRANT_TYPE_JWT_BEARER, assertion: 'eyJ.given.jwt' });
    expect(sent[0].headers.authorization).toBe(`Basic ${Buffer.from('app:s3cr3t').toString('base64')}`);
  });

  it('JWT bearer: needs an assertion or a key, and an issuer', async () => {
    await expect(getOAuth2Token(requestId, { type: 'oauth2', grantType: GRANT_TYPE_JWT_BEARER, accessTokenUrl: 'https://a/token' })).rejects.toThrow('needs an assertion, or a private key');
    await expect(getOAuth2Token(requestId, { type: 'oauth2', grantType: GRANT_TYPE_JWT_BEARER, accessTokenUrl: 'https://a/token', privateKey })).rejects.toThrow('needs an issuer');
  });

  it('token exchange: trades the subject token, with its type, and the actor and wanted type when given', async () => {
    await getOAuth2Token(requestId, {
      type: 'oauth2',
      grantType: GRANT_TYPE_TOKEN_EXCHANGE,
      accessTokenUrl: 'https://sts.example.com/token',
      subjectToken: 'user-token',
      actorToken: 'service-token',
      actorTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:id_token',
      audience: 'https://api.example.com',
      clientId: 'gateway',
    });

    expect(sent[0].form).toEqual({
      grant_type: GRANT_TYPE_TOKEN_EXCHANGE,
      subject_token: 'user-token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      actor_token: 'service-token',
      actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      requested_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      audience: 'https://api.example.com',
      // a public client: its ID, and no Basic header
      client_id: 'gateway',
    });
    expect(sent[0].headers.authorization).toBeUndefined();
    await expect(getOAuth2Token(requestId, { type: 'oauth2', grantType: GRANT_TYPE_TOKEN_EXCHANGE, accessTokenUrl: 'https://sts.example.com/token' }, true)).rejects.toThrow('needs the subject token');
  });

  it("device code: gets a code, shows it, and asks for the token until it's entered", async () => {
    const shown: DeviceAuthorization[] = [];
    let closed = 0;
    setDeviceCodeUi(({ authorization }) => {
      shown.push(authorization);
      return () => {
        closed++;
      };
    });
    let polls = 0;
    answer = (url, form) => {
      if (url === 'https://auth.example.com/device') {
        return { status: 200, body: JSON.stringify({ device_code: 'dev-1', user_code: 'WDJB-MJHT', verification_uri: 'https://example.com/device', expires_in: 600, interval: 1 }) };
      }
      expect(form).toEqual({ grant_type: GRANT_TYPE_DEVICE_CODE, device_code: 'dev-1', client_id: 'tv-app' });
      polls++;
      return polls < 2 ? { status: 400, body: '{"error":"authorization_pending"}' } : { status: 200, body: TOKENS };
    };

    const token = await getOAuth2Token(requestId, {
      type: 'oauth2',
      grantType: GRANT_TYPE_DEVICE_CODE,
      deviceAuthorizationUrl: 'https://auth.example.com/device',
      accessTokenUrl: 'https://auth.example.com/token',
      clientId: 'tv-app',
      scope: 'profile',
    });

    expect(token).toMatchObject({ accessToken: 'at-123' });
    expect(sent[0]).toMatchObject({ url: 'https://auth.example.com/device', form: { scope: 'profile', client_id: 'tv-app' } });
    expect(shown).toMatchObject([{ userCode: 'WDJB-MJHT', verificationUri: 'https://example.com/device' }]);
    expect(closed).toBe(1);
    expect(polls).toBe(2);
    // the poll that said "not yet" isn't kept
    expect((await models.response.findByParentId(`${requestId}.other`)).length).toBe(2);
  });

  it("sends the token request as built, under the workspace, so the request's folders add nothing", async () => {
    await getOAuth2Token(requestId, { type: 'oauth2', grantType: 'client_credentials', accessTokenUrl: 'https://auth.example.com/token', clientId: 'app', clientSecret: 's' });

    const network = networkModule as unknown as Record<string, jest.Mock<any>>;
    expect(network.tryToInterpolateRequest).toHaveBeenCalledWith(expect.objectContaining({ parentId: workspaceId }), 'env_1', undefined, undefined, undefined, true);
  });

  it('refreshes only at the token endpoint, for the client, the token came from', async () => {
    const authentication = { type: 'oauth2', grantType: 'client_credentials', accessTokenUrl: 'https://auth.example.com/token', clientId: 'app', clientSecret: 's' };
    answer = () => ({ status: 200, body: '{"access_token":"at-1","refresh_token":"rt-1","expires_in":1}' });
    expect(await getOAuth2Token(requestId, authentication)).toMatchObject({ refreshToken: 'rt-1', accessTokenUrl: 'https://auth.example.com/token', clientId: 'app' });
    const expire = async () => models.oAuth2Token.update((await models.oAuth2Token.getByParentId(requestId))!, { expiresAt: Date.now() - 1000 });

    await expire();
    await getOAuth2Token(requestId, { ...authentication, accessTokenUrl: 'https://other.example.com/token' });
    expect(sent[1]).toMatchObject({ url: 'https://other.example.com/token', form: { grant_type: 'client_credentials' } });
    expect(sent[1].form.refresh_token).toBeUndefined();

    await expire();
    await getOAuth2Token(requestId, { ...authentication, accessTokenUrl: 'https://other.example.com/token', clientId: 'another' });
    expect(sent[2].form).toMatchObject({ grant_type: 'client_credentials' });

    await expire();
    await getOAuth2Token(requestId, { ...authentication, accessTokenUrl: 'https://other.example.com/token', clientId: 'another' });
    expect(sent[3].form).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
  });
});

describe('device code polling', () => {
  const authorization = readDeviceAuthorization({ device_code: 'd', user_code: 'U', verification_url: 'https://g.co/device', interval: 2 }, 0);
  const answers = (...bodies: (Record<string, any> | null)[]) => {
    const left = [...bodies];
    return async () => {
      const body = left.shift() ?? null;
      return { status: body?.error ? 400 : 200, body };
    };
  };

  it("reads the provider's answer, as Google words it too", () => {
    expect(authorization).toEqual({ deviceCode: 'd', userCode: 'U', verificationUri: 'https://g.co/device', expiresAt: 900_000, intervalMs: 2000 });
    expect(() => readDeviceAuthorization({ error: 'invalid_client', error_description: 'unknown' })).toThrow('OAuth 2.0 Error invalid_client: unknown');
    expect(() => readDeviceAuthorization({ user_code: 'U' })).toThrow('left out the device code');
  });

  it('waits the interval, 5 s longer after slow_down, until the token', async () => {
    const waits: number[] = [];
    const answer = await pollForToken(authorization, answers({ error: 'authorization_pending' }, { error: 'slow_down' }, { error: 'authorization_pending' }, { access_token: 'x' }), {
      sleep: async ms => {
        waits.push(ms);
      },
      now: () => 0,
    });
    expect(answer.body).toEqual({ access_token: 'x' });
    expect(waits).toEqual([2000, 2000, 7000, 7000]);
  });

  it('stops when declined, expired, cancelled, or the code runs out', async () => {
    const quick = { sleep: async () => {}, now: () => 0 };
    await expect(pollForToken(authorization, answers({ error: 'access_denied' }), quick)).rejects.toThrow('declined');
    await expect(pollForToken(authorization, answers({ error: 'expired_token' }), quick)).rejects.toThrow('expired');
    await expect(pollForToken(authorization, answers(), { sleep: async () => {}, now: () => 900_000 })).rejects.toThrow('expired');

    setDeviceCodeUi(({ cancel }) => {
      cancel();
      return () => {};
    });
    await expect(pollForToken(authorization, answers({ access_token: 'x' }), quick)).rejects.toThrow('cancelled');
  });

  it('hands back any other answer, for the caller to report', async () => {
    setDeviceCodeUi(() => () => {});
    const answer = await pollForToken(authorization, answers({ error: 'invalid_grant' }), { sleep: async () => {}, now: () => 0 });
    expect(answer).toEqual({ status: 400, body: { error: 'invalid_grant' } });
  });
});
