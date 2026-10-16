import type { CookieJar } from '../../models/cookie-jar';
import type { Request, RequestAuthentication, RequestHeader } from '../../models/request';
import { parseHeaderStrings } from './parse-header-strings';

// A server-sent events connection as the renderer resolved it
// (network.ts prepareEventStreamConnection): rendered, plugin hooks applied,
// auth headers added.
export interface EventStreamConnection {
  url: string;
  socketPath?: string;
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
// from the stored request. Streams go out as a bodiless GET: nothing sets a
// method or body on the connection, so AWS signing must sign exactly that.
export const buildEventStreamCurlRequest = (connection: EventStreamConnection) => {
  const req = { ...connection, method: 'GET', body: {} };
  return { req, headerStrings: parseHeaderStrings({ req, finalUrl: connection.url }) };
};
