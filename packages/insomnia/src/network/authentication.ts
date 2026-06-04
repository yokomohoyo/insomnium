import * as Hawk from 'hawk';

import {
  AUTH_API_KEY,
  AUTH_ASAP,
  AUTH_BASIC,
  AUTH_BEARER,
  AUTH_GCP_ID_TOKEN,
  AUTH_HAWK,
  AUTH_OAUTH_1,
  AUTH_OAUTH_2,
} from '../common/constants';
import type { RenderedRequest } from '../common/render';
import {
  AuthTypeOAuth2,
  getAuthStrategies,
  RequestAuthenticationStrategy,
  RequestParameter,
} from '../models/request';
import { COOKIE, HEADER, QUERY_PARAMS } from './api-key/constants';
import { getBasicAuthHeader } from './basic-auth/get-header';
import { getBearerAuthHeader } from './bearer-auth/get-header';
import { CredentialSource, defaultAudienceForUrl, getGcpIdToken } from './gcp-id-token/get-token';
import getOAuth1Token from './o-auth-1/get-token';
import { getOAuth2Token } from './o-auth-2/get-token';

interface Header {
  name: string;
  value: string;
}

// Resolve one auth strategy into a single Header (or undefined if it doesn't emit one).
async function resolveAuthStrategy(
  strategy: RequestAuthenticationStrategy,
  renderedRequest: RenderedRequest,
  url: string,
): Promise<Header | undefined> {
  const { method, body } = renderedRequest;
  const requestId = renderedRequest._id;

  if (strategy.disabled) {
    return undefined;
  }

  if (strategy.type === AUTH_API_KEY && strategy.addTo === HEADER) {
    const { key, value } = strategy;
    return { name: key, value: value };
  }

  if (strategy.type === AUTH_API_KEY && strategy.addTo === COOKIE) {
    const { key, value } = strategy;
    return { name: 'Cookie', value: `${key}=${value}` };
  }

  if (strategy.type === AUTH_BASIC) {
    const { username, password, useISO88591 } = strategy;
    const encoding = useISO88591 ? 'latin1' : 'utf8';
    return getBasicAuthHeader(username, password, encoding);
  }

  if (strategy.type === AUTH_BEARER) {
    const { token, prefix } = strategy;
    return getBearerAuthHeader(token, prefix);
  }

  if (strategy.type === AUTH_GCP_ID_TOKEN) {
    const { credentialSource, saFilePath, saInlineJson, audience, impersonateServiceAccount } = strategy as {
      credentialSource?: 'adc' | 'sa-file' | 'sa-inline';
      saFilePath?: string;
      saInlineJson?: string;
      audience?: string;
      impersonateServiceAccount?: string;
    };
    const target = impersonateServiceAccount?.trim() || undefined;
    const source: CredentialSource = credentialSource === 'sa-file'
      ? { kind: 'sa-file', path: saFilePath || '', impersonateServiceAccount: target }
      : credentialSource === 'sa-inline'
        ? { kind: 'sa-inline', json: saInlineJson || '', impersonateServiceAccount: target }
        : { kind: 'adc', impersonateServiceAccount: target };
    const aud = (audience && audience.trim()) || defaultAudienceForUrl(url);
    const token = await getGcpIdToken({ source, audience: aud });
    return { name: 'Authorization', value: `Bearer ${token}` };
  }

  if (strategy.type === AUTH_OAUTH_2) {
    // HACK: GraphQL requests use a child request to fetch the schema with an
    // ID of "{{request_id}}.graphql". Reuse the parent's tokens. See #835.
    try {
      const tokenId = requestId.match(/\.graphql$/) ? requestId.replace(/\.graphql$/, '') : requestId;
      const oAuth2Token = await getOAuth2Token(tokenId, strategy as unknown as AuthTypeOAuth2);
      if (oAuth2Token) {
        return _buildBearerHeader(oAuth2Token.accessToken, strategy.tokenPrefix);
      }
      return undefined;
    } catch (err) {
      console.log('[oauth2] Failed to get token', err);
      return undefined;
    }
  }

  if (strategy.type === AUTH_OAUTH_1) {
    const oAuth1Token = await getOAuth1Token(url, method, strategy, body);
    if (oAuth1Token) {
      return { name: 'Authorization', value: oAuth1Token.Authorization };
    }
    return undefined;
  }

  if (strategy.type === AUTH_HAWK) {
    const { id, key, algorithm, ext, validatePayload } = strategy;
    let headerOptions: any = {
      credentials: { id, key, algorithm },
      ext,
    };
    if (validatePayload) {
      headerOptions = {
        payload: renderedRequest.body.text,
        contentType: renderedRequest.body.mimeType,
        ...headerOptions,
      };
    }
    const { header } = Hawk.client.header(url, method, headerOptions);
    return { name: 'Authorization', value: header };
  }

  if (strategy.type === AUTH_ASAP) {
    const { issuer, subject, audience, keyId, additionalClaims, privateKey } = strategy;
    let parsedAdditionalClaims;
    try {
      parsedAdditionalClaims = JSON.parse(additionalClaims || '{}');
    } catch (err) {
      throw new Error(`Unable to parse additional-claims: ${err}`);
    }
    if (parsedAdditionalClaims && typeof parsedAdditionalClaims !== 'object') {
      throw new Error(
        `additional-claims must be an object received: '${typeof parsedAdditionalClaims}' instead`,
      );
    }
    const generator = (await import('httplease-asap')).createAuthHeaderGenerator({
      privateKey,
      issuer,
      keyId,
      audience,
      subject,
      additionalClaims: parsedAdditionalClaims,
      tokenExpiryMs: 10 * 60 * 1000,
      tokenMaxAgeMs: 9 * 60 * 1000,
    });
    return { name: 'Authorization', value: generator() };
  }

  return undefined;
}

// Iterate all enabled strategies and return their headers in declaration order.
// Each strategy may override its destination header via `strategy.headerName`.
// Same-named headers later in the list win (with a console warning).
export async function getAuthHeaders(renderedRequest: RenderedRequest, url: string): Promise<Header[]> {
  const strategies = getAuthStrategies(renderedRequest.authentication);
  const out: Header[] = [];
  for (const strategy of strategies) {
    const header = await resolveAuthStrategy(strategy, renderedRequest, url);
    if (!header) continue;
    const finalName = strategy.headerName || header.name;
    const existing = out.findIndex(h => h.name.toLowerCase() === finalName.toLowerCase());
    if (existing >= 0) {
      console.warn(`[auth] Strategy ${strategy.type} overwriting existing ${finalName} header`);
      out[existing] = { name: finalName, value: header.value };
    } else {
      out.push({ name: finalName, value: header.value });
    }
  }
  return out;
}

// Back-compat single-header shim. Returns the FIRST emitted header for callers
// not yet migrated to the array API.
export async function getAuthHeader(renderedRequest: RenderedRequest, url: string): Promise<Header | undefined> {
  const headers = await getAuthHeaders(renderedRequest, url);
  return headers[0];
}

export function getAuthQueryParamsList(authentication: RequestAuthenticationStrategy | RequestAuthenticationStrategy[] | undefined): RequestParameter[] {
  const strategies = getAuthStrategies(authentication);
  const out: RequestParameter[] = [];
  for (const strategy of strategies) {
    if (strategy.disabled) continue;
    if (strategy.type === AUTH_API_KEY && strategy.addTo === QUERY_PARAMS) {
      out.push({ name: strategy.key, value: strategy.value } as RequestParameter);
    }
  }
  return out;
}

// Back-compat single-param shim.
export function getAuthQueryParams(authentication: RequestAuthenticationStrategy | RequestAuthenticationStrategy[] | undefined) {
  return getAuthQueryParamsList(authentication)[0];
}

export const _buildBearerHeader = (accessToken: string, prefix: string) => {
  if (!accessToken) {
    return;
  }

  const header = {
    name: 'Authorization',
    value: '',
  };

  if (prefix === 'NO_PREFIX') {
    header.value = accessToken;
  } else {
    header.value = `${prefix || 'Bearer'} ${accessToken}`;
  }

  return header;
};
