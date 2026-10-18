import { CONTENT_TYPE_FORM_DATA } from '../../common/constants';
import type { CookieJar } from '../../models/cookie-jar';
import type { Request, RequestAuthentication, RequestBody, RequestHeader } from '../../models/request';
import { parseHeaderStrings } from './parse-header-strings';
import { parseRequestBody } from './request-body';

// A server-sent events connection as the renderer resolved it
// (network.ts prepareEventStreamConnection): rendered, plugin hooks applied,
// auth headers added.
export interface EventStreamConnection {
  url: string;
  socketPath?: string;
  method: string;
  body: RequestBody;
  headers: RequestHeader[];
  authentication: RequestAuthentication;
  cookieJar: CookieJar;
  cookies: { name: string; value: string }[];
  suppressUserAgent: boolean;
  settingSendCookies: boolean;
  settingStoreCookies: boolean;
  settingFollowRedirects: Request['settingFollowRedirects'];
  settingRebuildPath: boolean;
}

// The curl request for a connection, built only from what was resolved, never
// from the stored request. A stream sends its method and a text or urlencoded
// body (as most streaming APIs want a POST); AWS signing signs exactly those.
export const buildEventStreamCurlRequest = (connection: EventStreamConnection) => {
  const { method, body } = connection;
  if (body.fileName || body.mimeType === CONTENT_TYPE_FORM_DATA) {
    throw new Error('An event stream can only send a text or form URL-encoded body');
  }
  const req = { ...connection };
  const requestBody = parseRequestBody({ body, method });
  return { req, requestBody, headerStrings: parseHeaderStrings({ req, requestBody, finalUrl: connection.url }) };
};
