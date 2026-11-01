import crypto from 'crypto';
import querystring from 'querystring';
import { v4 as uuidv4 } from 'uuid';

import { escapeRegex, withoutSecrets } from '../../common/misc';
import * as models from '../../models';
import type { OAuth2Token } from '../../models/o-auth-2-token';
import type { AuthTypeOAuth2, OAuth2ResponseType, RequestHeader, RequestParameter } from '../../models/request';
import type { Request } from '../../models/request';
import type { Response } from '../../models/response';
import { guard } from '../../utils/guard';
import { setDefaultProtocol } from '../../utils/url/protocol';
import { getBasicAuthHeader } from '../basic-auth/get-header';
import { CLIENT_ASSERTION_TYPE, clientAssertion, grantAssertion } from './client-assertion';
import { pollForToken, readDeviceAuthorization } from './device-code';
import { redactTokenResponse } from './redact';
import { fetchRequestData, responseTransform, sendCurlAndWriteTimeline, tryToInterpolateRequest, tryToTransformRequestWithPlugins } from '../network';
import {
  AuthKeys,
  GRANT_TYPE_AUTHORIZATION_CODE,
  GRANT_TYPE_DEVICE_CODE,
  GRANT_TYPE_JWT_BEARER,
  GRANT_TYPE_TOKEN_EXCHANGE,
  PKCE_CHALLENGE_S256,
  TOKEN_TYPE_ACCESS_TOKEN,
} from './constants';

const LOCALSTORAGE_KEY_SESSION_ID = 'insomnia::current-oauth-session-id';

export function initNewOAuthSession() {
  // the value of this variable needs to start with 'persist:'
  // otherwise sessions won't be persisted over application-restarts
  const authWindowSessionId = `persist:oauth2_${uuidv4()}`;
  window.localStorage.setItem(LOCALSTORAGE_KEY_SESSION_ID, authWindowSessionId);
  return authWindowSessionId;
}

export function getOAuthSession(): string {
  const token = window.localStorage.getItem(LOCALSTORAGE_KEY_SESSION_ID);
  return token || initNewOAuthSession();
}

// NOTE
// 1. return valid access token from insomnia db
// 2. send refresh token in order to save and return valid access token
// 3. run a given grant type and save and return valid access token
export const getOAuth2Token = async (
  requestId: string,
  authentication: AuthTypeOAuth2,
  forceRefresh = false,
): Promise<OAuth2Token | null> => {
  const oAuth2Token = await getExistingAccessTokenAndRefreshIfExpired(requestId, authentication, forceRefresh);
  if (oAuth2Token) {
    return oAuth2Token;
  }
  const token = await getNewOAuth2Token(requestId, authentication);
  // where it came from, so its refresh token goes back only there
  return token && models.oAuth2Token.update(token, tokenSource(authentication));
};

export const tokenSource = (authentication: Pick<AuthTypeOAuth2, 'accessTokenUrl' | 'clientId'>) => ({
  accessTokenUrl: authentication.accessTokenUrl || '',
  clientId: authentication.clientId || '',
});

const getNewOAuth2Token = async (requestId: string, authentication: AuthTypeOAuth2): Promise<OAuth2Token | null> => {
  const validGrantType = ['implicit', 'authorization_code', 'password', 'client_credentials', GRANT_TYPE_DEVICE_CODE, GRANT_TYPE_JWT_BEARER, GRANT_TYPE_TOKEN_EXCHANGE].includes(authentication.grantType);
  guard(validGrantType, `Invalid grant type ${authentication.grantType}`);
  if (authentication.grantType === 'implicit') {
    guard(authentication.authorizationUrl, 'Missing authorization URL');
    const responseTypeOrFallback = authentication.responseType || 'token';
    const hasNonce = responseTypeOrFallback === 'id_token token' || responseTypeOrFallback === 'id_token';
    const implicitUrl = new URL(authentication.authorizationUrl);
    [
      { name: 'response_type', value: responseTypeOrFallback },
      { name: 'client_id', value: authentication.clientId },
      ...insertAuthKeyIf('redirect_uri', authentication.redirectUrl),
      ...insertAuthKeyIf('scope', authentication.scope),
      ...insertAuthKeyIf('state', authentication.state),
      ...insertAuthKeyIf('audience', authentication.audience),
      ...(hasNonce ? [{
        name: 'nonce', value: Math.floor(Math.random() * 9999999999999) + 1 + '',
      }] : []),
    ].forEach(p => p.value && implicitUrl.searchParams.append(p.name, p.value));
    const redirectedTo = await window.main.authorizeUserInWindow({
      url: implicitUrl.toString(),
      urlSuccessRegex: /(access_token=|id_token=)/,
      urlFailureRegex: /(error=)/,
      sessionId: getOAuthSession(),
    });
    console.log('[oauth2] Detected redirect ' + withoutSecrets(redirectedTo));

    const responseUrl = new URL(redirectedTo);
    if (responseUrl.searchParams.has('error')) {
      const params = Object.fromEntries(responseUrl.searchParams);
      const old = await models.oAuth2Token.getOrCreateByParentId(requestId);
      return models.oAuth2Token.update(old, transformNewAccessTokenToOauthModel(params));
    }
    const hash = responseUrl.hash.slice(1);
    guard(hash, 'No hash found in response URL from OAuth2 provider');
    const data = Object.fromEntries(new URLSearchParams(hash));
    const old = await models.oAuth2Token.getOrCreateByParentId(requestId);
    return models.oAuth2Token.update(old, transformNewAccessTokenToOauthModel({
      ...data,
      access_token: data.access_token || data.id_token,
    }));
  }
  guard(authentication.accessTokenUrl, 'Missing access token URL');
  if (authentication.grantType === GRANT_TYPE_DEVICE_CODE) {
    return getTokenWithDeviceCode(requestId, authentication);
  }
  let params: RequestHeader[] = [];
  // the newer grants send the client's credentials only when it has some
  let clientAuthentication = withClientAuthentication;
  if (authentication.grantType === 'authorization_code') {
    guard(authentication.authorizationUrl, 'Invalid authorization URL');

    const codeVerifier = authentication.usePkce ? encodePKCE(crypto.randomBytes(32)) : '';
    const usePkceAnd256 = authentication.usePkce && authentication.pkceMethod === PKCE_CHALLENGE_S256;
    const codeChallenge = usePkceAnd256 ? encodePKCE(crypto.createHash('sha256').update(codeVerifier).digest()) : codeVerifier;
    const authCodeUrl = new URL(authentication.authorizationUrl);
    const responseType: OAuth2ResponseType = 'code';
    [
      { name: 'response_type', value: responseType },
      { name: 'client_id', value: authentication.clientId },
      ...insertAuthKeyIf('redirect_uri', authentication.redirectUrl),
      ...insertAuthKeyIf('scope', authentication.scope),
      ...insertAuthKeyIf('state', authentication.state),
      ...insertAuthKeyIf('audience', authentication.audience),
      ...insertAuthKeyIf('resource', authentication.resource),
      ...(codeChallenge ? [
        { name: 'code_challenge', value: codeChallenge },
        { name: 'code_challenge_method', value: authentication.pkceMethod },
      ] : []),
    ].forEach(p => p.value && authCodeUrl.searchParams.append(p.name, p.value));
    let redirectedTo: string;
    let redirectUri = authentication.redirectUrl;
    // the state a redirect to the system browser's loopback server must bring
    // back, so another page can't hand it a code
    let expectedState: string | undefined;
    if (authentication.useSystemBrowser) {
      guard(authentication.redirectUrl, 'To sign in with the system browser, set a loopback redirect URL, such as http://127.0.0.1:8484/callback');
      expectedState = authentication.state || encodePKCE(crypto.randomBytes(16));
      authCodeUrl.searchParams.set('state', expectedState);
      authCodeUrl.searchParams.delete('redirect_uri');
      ({ redirectedTo, redirectUri } = await window.main.authorizeInSystemBrowser({
        url: authCodeUrl.toString(),
        redirectUrl: authentication.redirectUrl,
      }));
    } else {
      redirectedTo = await window.main.authorizeUserInWindow({
        url: authCodeUrl.toString(),
        urlSuccessRegex: authentication.redirectUrl ?
          new RegExp(`${escapeRegex(authentication.redirectUrl)}.*([?&]code=)`, 'i') : /([?&]code=)/i,
        urlFailureRegex: authentication.redirectUrl ?
          new RegExp(`${escapeRegex(authentication.redirectUrl)}.*([?&]error=)`, 'i') : /([?&]error=)/i,
        sessionId: getOAuthSession(),
      });
    }
    console.log('[oauth2] Detected redirect ' + withoutSecrets(redirectedTo));
    const redirectParams = Object.fromEntries(new URL(redirectedTo).searchParams);
    if (redirectParams.error) {
      const code = redirectParams.error;
      const msg = redirectParams.error_description;
      const uri = redirectParams.error_uri;
      throw new Error(`OAuth 2.0 Error ${code}\n\n${msg}\n\n${uri}`);
    }
    if (expectedState !== undefined && redirectParams.state !== expectedState) {
      throw new Error("The sign-in came back with a different state than it was sent with, so it wasn't used");
    }
    params = [
      { name: 'grant_type', value: GRANT_TYPE_AUTHORIZATION_CODE },
      { name: 'code', value: redirectParams.code },
      ...insertAuthKeyIf('redirect_uri', redirectUri),
      ...insertAuthKeyIf('state', authentication.state),
      ...insertAuthKeyIf('audience', authentication.audience),
      ...insertAuthKeyIf('resource', authentication.resource),
      ...insertAuthKeyIf('code_verifier', codeVerifier),
    ];
  } else if (authentication.grantType === 'password') {
    params = [
      { name: 'grant_type', value: 'password' },
      ...insertAuthKeyIf('username', authentication.username),
      ...insertAuthKeyIf('password', authentication.password),
      ...insertAuthKeyIf('scope', authentication.scope),
      ...insertAuthKeyIf('audience', authentication.audience),
    ];
  } else if (authentication.grantType === 'client_credentials') {
    params = [
      { name: 'grant_type', value: 'client_credentials' },
      ...insertAuthKeyIf('scope', authentication.scope),
      ...insertAuthKeyIf('audience', authentication.audience),
      ...insertAuthKeyIf('resource', authentication.resource),
    ];
  } else if (authentication.grantType === GRANT_TYPE_JWT_BEARER) {
    params = [
      { name: 'grant_type', value: GRANT_TYPE_JWT_BEARER },
      { name: 'assertion', value: jwtBearerAssertion(authentication) },
      ...insertAuthKeyIf('scope', authentication.scope),
    ];
    // the private key signs the grant's assertion here, not the client's
    clientAuthentication = (auth, params, headers) => optionalClientAuthentication({ ...auth, usePrivateKeyJwt: false }, params, headers);
  } else if (authentication.grantType === GRANT_TYPE_TOKEN_EXCHANGE) {
    guard(authentication.subjectToken, 'A token exchange needs the subject token, the token to trade');
    params = [
      { name: 'grant_type', value: GRANT_TYPE_TOKEN_EXCHANGE },
      { name: 'subject_token', value: authentication.subjectToken },
      { name: 'subject_token_type', value: authentication.subjectTokenType || TOKEN_TYPE_ACCESS_TOKEN },
      ...(authentication.actorToken ? [
        { name: 'actor_token', value: authentication.actorToken },
        { name: 'actor_token_type', value: authentication.actorTokenType || TOKEN_TYPE_ACCESS_TOKEN },
      ] : []),
      ...(authentication.requestedTokenType ? [{ name: 'requested_token_type', value: authentication.requestedTokenType }] : []),
      ...insertAuthKeyIf('audience', authentication.audience),
      ...insertAuthKeyIf('resource', authentication.resource),
      ...insertAuthKeyIf('scope', authentication.scope),
    ];
    clientAuthentication = optionalClientAuthentication;
  }
  const headers = authentication.origin ? [{ name: 'Origin', value: authentication.origin }] : [];
  const authenticated = clientAuthentication(authentication, params, headers);
  const { response, body } = await sendAccessTokenRequest(requestId, authentication, authenticated.params, authenticated.headers);
  const old = await models.oAuth2Token.getOrCreateByParentId(requestId);
  return models.oAuth2Token.update(old, transformNewAccessTokenToOauthModel(
    oauthResponseToAccessToken(authentication.accessTokenUrl, response, body)
  ));
};

// The JWT bearer grant's assertion: as given, or signed here with the private key
export const jwtBearerAssertion = (authentication: AuthTypeOAuth2) => {
  if (authentication.assertion) {
    return authentication.assertion;
  }
  guard(authentication.privateKey, 'The JWT bearer grant needs an assertion, or a private key to sign one with');
  const issuer = authentication.assertionIssuer || authentication.clientId;
  guard(issuer, 'The assertion needs an issuer: set the issuer, or the client ID');
  guard(authentication.accessTokenUrl, 'Missing access token URL');
  return grantAssertion({
    issuer,
    subject: authentication.assertionSubject || undefined,
    audience: authentication.audience || authentication.accessTokenUrl,
    scope: authentication.scope || undefined,
    privateKey: authentication.privateKey,
    algorithm: authentication.privateKeyAlgorithm || undefined,
    keyId: authentication.privateKeyId || undefined,
  });
};

// The device code grant: a code from the device authorization endpoint, shown
// to the user (device-code.ts), then the token endpoint asked until they've
// entered it. Polls that only say "not yet" aren't kept as responses.
async function getTokenWithDeviceCode(requestId: string, authentication: AuthTypeOAuth2) {
  guard(authentication.deviceAuthorizationUrl, 'Missing device authorization URL');
  guard(authentication.accessTokenUrl, 'Missing access token URL');
  const accessTokenUrl = authentication.accessTokenUrl;
  const headers = authentication.origin ? [{ name: 'Origin', value: authentication.origin }] : [];
  const asked = optionalClientAuthentication(authentication, [
    ...insertAuthKeyIf('scope', authentication.scope),
    ...insertAuthKeyIf('audience', authentication.audience),
  ], headers);
  const first = await sendAccessTokenRequest(requestId, { ...authentication, accessTokenUrl: authentication.deviceAuthorizationUrl }, asked.params, asked.headers);
  const firstBody = first.body ? tryToParse(first.body.toString()) : null;
  if (first.response.statusCode < 200 || first.response.statusCode >= 300) {
    const reason = firstBody?.error ? ` ${firstBody.error}` : '';
    throw new Error('Failed to get a device code url=' + authentication.deviceAuthorizationUrl + ' status=' + first.response.statusCode + reason);
  }
  const authorization = readDeviceAuthorization(firstBody);
  let last = first;
  await pollForToken(authorization, async () => {
    const polled = optionalClientAuthentication(authentication, [
      { name: 'grant_type', value: GRANT_TYPE_DEVICE_CODE },
      { name: 'device_code', value: authorization.deviceCode },
    ], headers);
    const sent = await sendAccessTokenRequest(requestId, authentication, polled.params, polled.headers);
    const body = sent.body ? tryToParse(sent.body.toString()) : null;
    if (body?.error === 'authorization_pending' || body?.error === 'slow_down') {
      await models.response.remove(sent.response);
    }
    last = sent;
    return { status: sent.response.statusCode, body };
  });
  const old = await models.oAuth2Token.getOrCreateByParentId(requestId);
  return models.oAuth2Token.update(old, transformNewAccessTokenToOauthModel(
    oauthResponseToAccessToken(accessTokenUrl, last.response, last.body)
  ));
}

// 1. get token from db and return if valid
// 2. if expired, and no refresh token return null
// 3. run refresh token query and return new token or null if it fails

async function getExistingAccessTokenAndRefreshIfExpired(
  requestId: string,
  authentication: AuthTypeOAuth2,
  forceRefresh: boolean,
): Promise<OAuth2Token | null> {
  const token: OAuth2Token | null = await models.oAuth2Token.getByParentId(requestId);
  if (!token) {
    return null;
  }
  const expiresAt = token.expiresAt || Infinity;
  const isExpired = Date.now() > expiresAt;
  if (!isExpired && !forceRefresh) {
    return token;
  }
  // a refresh token goes only to the token endpoint, for the client, it came
  // from: after either changes, a new grant
  const source = tokenSource(authentication);
  if (!token.refreshToken || token.accessTokenUrl !== source.accessTokenUrl || token.clientId !== source.clientId) {
    return null;
  }

  const params = [
    { name: 'grant_type', value: 'refresh_token' },
    { name: 'refresh_token', value: token.refreshToken },
    ...insertAuthKeyIf('scope', authentication.scope),
  ];
  // the client's credentials go with a refresh too (they used to be left out
  // when they were sent as a Basic header)
  const authenticated = withClientAuthentication(authentication, params, []);
  const { response, body: bodyBuffer } = await sendAccessTokenRequest(requestId, authentication, authenticated.params, authenticated.headers);

  const statusCode = response.statusCode || 0;

  if (statusCode === 401) {
    // If the refresh token was rejected due an unauthorized request, we will
    // return a null access_token to trigger an authentication request to fetch
    // brand new refresh and access tokens.
    const old = await models.oAuth2Token.getOrCreateByParentId(requestId);
    models.oAuth2Token.update(old, transformNewAccessTokenToOauthModel({ access_token: null }));
    return null;
  }
  const isSuccessful = statusCode >= 200 && statusCode < 300;
  const hasBodyAndIsError = bodyBuffer && statusCode === 400;
  if (!isSuccessful) {
    if (hasBodyAndIsError) {
      const body = tryToParse(bodyBuffer.toString());
      // If the refresh token was rejected due an oauth2 invalid_grant error, we will
      // return a null access_token to trigger an authentication request to fetch
      // brand new refresh and access tokens.
      if (body?.error === 'invalid_grant') {
        console.log(`[oauth2] Refresh token rejected due to invalid_grant error: ${body.error_description}`);
        const old = await models.oAuth2Token.getOrCreateByParentId(requestId);
        models.oAuth2Token.update(old, transformNewAccessTokenToOauthModel({ access_token: null }));
        return null;
      }
    }

    throw new Error(`[oauth2] Failed to refresh token url=${authentication.accessTokenUrl} status=${statusCode}`);
  }
  guard(bodyBuffer, `[oauth2] No body returned from ${authentication.accessTokenUrl}`);
  const data = tryToParse(bodyBuffer.toString());
  if (!data) {
    return null;
  }
  const old = await models.oAuth2Token.getOrCreateByParentId(requestId);
  return models.oAuth2Token.update(old, transformNewAccessTokenToOauthModel({
    ...data,
    refresh_token: data.refresh_token || token.refreshToken,
  }));
}

// the body as it came (the response's file has the tokens replaced, redact.ts)
export const oauthResponseToAccessToken = (accessTokenUrl: string, response: Response, bodyBuffer = models.response.getBodyBuffer(response)) => {
  if (!bodyBuffer) {
    return {
      xResponseId: response._id,
      xError: `No body returned from ${accessTokenUrl}`,
    };
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return {
      xResponseId: response._id,
      xError: `Failed to fetch token url=${accessTokenUrl} status=${response.statusCode}`,
    };
  }
  const body = bodyBuffer.toString('utf8');
  const data = tryToParse(body);
  return {
    ...data,
    xResponseId: response._id,
  };
};

const transformNewAccessTokenToOauthModel = (accessToken: Partial<Record<AuthKeys, string | null>>): Partial<OAuth2Token> => {
  const expiry = accessToken.expires_in ? +accessToken.expires_in : 0;
  return {
    // Calculate expiry date
    expiresAt: accessToken.expires_in ? Date.now() + expiry * 1000 : null,
    refreshToken: accessToken.refresh_token || undefined,
    accessToken: accessToken.access_token || undefined,
    identityToken: accessToken.id_token || undefined,
    error: accessToken.error || undefined,
    errorDescription: accessToken.error_description || undefined,
    errorUri: accessToken.error_uri || undefined,
    // Special Case for response timeline viewing
    xResponseId: accessToken.xResponseId || null,
    // Special Case for empty body or http error code custom messages
    xError: accessToken.xError || null,
  };
};

const sendAccessTokenRequest = async (requestId: string, authentication: AuthTypeOAuth2, params: RequestParameter[], headers: RequestHeader[]) => {
  guard(authentication.accessTokenUrl, 'Missing access token URL');
  console.log(`[network] Sending with settings req=${requestId}`);
  // @TODO unpack oauth into regular timeline and remove oauth timeine dialog
  const { request,
    workspace,
    environment,
    settings,
    clientCertificates,
    caCert,
    activeEnvironmentId } = await fetchRequestData(requestId);

  const newRequest: Request = await models.initModel(models.request.type, {
    headers: [
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
      { name: 'Accept', value: 'application/x-www-form-urlencoded, application/json' },
      ...headers,
    ],
    url: setDefaultProtocol(authentication.accessTokenUrl),
    method: 'POST',
    // it carries the client's secret: not on to wherever a redirect says
    settingFollowRedirects: 'off',
    body: {
      mimeType: 'application/x-www-form-urlencoded',
      params,
    },
  }, {
    _id: request._id + '.other',
    // the workspace's, not the request's: its folders' headers and auth are
    // for the API, not the token endpoint
    parentId: workspace._id,
  });

  // as built, from values already rendered: rendered again, the token
  // server's own values (a refresh token, a code) would be templates
  const renderResult = await tryToInterpolateRequest(newRequest, environment._id, undefined, undefined, undefined, true);
  const renderedRequest = await tryToTransformRequestWithPlugins(renderResult);

  const response = await sendCurlAndWriteTimeline(
    renderResult.request,
    clientCertificates,
    caCert,
    { ...settings, validateSSL: settings.validateAuthSSL },
  );
  const responsePatch = await responseTransform(response, activeEnvironmentId, renderedRequest, renderResult.context);

  const created = await models.response.create(responsePatch);
  // the tokens read, before its files are kept without them
  const body = models.response.getBodyBuffer(created);
  await redactTokenResponse(created);
  return { response: created, body };
};
export const encodePKCE = (buffer: Buffer) => {
  return buffer.toString('base64')
    // The characters + / = are reserved for PKCE as per the RFC,
    // so we replace them with unreserved characters
    // Docs: https://tools.ietf.org/html/rfc7636#section-4.2
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};
const tryToParse = (body: string): Record<string, any> | null => {
  try {
    return JSON.parse(body);
  } catch (err) { }

  try {
    // NOTE: parse does not return a JS Object, so
    //   we cannot use hasOwnProperty on it
    return querystring.parse(body);
  } catch (err) { }
  return null;
};

const insertAuthKeyIf = (name: AuthKeys, value?: string) => value ? [{ name, value }] : [];

// For grants where the client may be public: its credentials when it has
// some, or else just its ID, if any
export const optionalClientAuthentication = (authentication: AuthTypeOAuth2, params: RequestParameter[], headers: RequestHeader[]) =>
  authentication.usePrivateKeyJwt || authentication.clientSecret
    ? withClientAuthentication(authentication, params, headers)
    : { params: [...params, ...insertAuthKeyIf('client_id', authentication.clientId)], headers };

// how a token request says which client it's from: a signed JWT
// (private_key_jwt), the id and secret in the body, or a Basic header
export const withClientAuthentication = (authentication: AuthTypeOAuth2, params: RequestParameter[], headers: RequestHeader[]) => {
  if (authentication.usePrivateKeyJwt) {
    guard(authentication.clientId, 'A client assertion needs the client ID');
    guard(authentication.privateKey, 'A client assertion needs the private key to sign it with');
    guard(authentication.accessTokenUrl, 'Missing access token URL');
    return {
      params: [
        ...params,
        { name: 'client_id', value: authentication.clientId },
        { name: 'client_assertion_type', value: CLIENT_ASSERTION_TYPE },
        {
          name: 'client_assertion', value: clientAssertion({
            clientId: authentication.clientId,
            audience: authentication.accessTokenUrl,
            privateKey: authentication.privateKey,
            algorithm: authentication.privateKeyAlgorithm || undefined,
            keyId: authentication.privateKeyId || undefined,
          }),
        },
      ],
      headers,
    };
  }
  if (authentication.credentialsInBody) {
    return {
      params: [
        ...params,
        ...insertAuthKeyIf('client_id', authentication.clientId),
        ...insertAuthKeyIf('client_secret', authentication.clientSecret),
      ],
      headers,
    };
  }
  return { params, headers: [...headers, getBasicAuthHeader(authentication.clientId, authentication.clientSecret)] };
};
