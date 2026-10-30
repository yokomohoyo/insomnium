import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import * as models from '../../../models';
import type { Cookie } from '../../../models/cookie-jar';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// tough-cookie's latest date, which the cookie editor gives a new cookie
const MAX_TIME = 2147483647000;

// a cookie is the one with this domain, path and name, as a browser keys it
const sameCookie = (cookie: Cookie, domain: string, path: string, key: string) =>
  cookie.domain === domain && cookie.path === path && cookie.key === key;

// Changing the cookie jar, past list_cookies, as the Manage Cookies dialog does
export function registerCookieTools(server: McpServer) {
  server.tool(
    'set_cookie',
    "Add a cookie to a workspace's cookie jar, or change the one with the same domain, path and name. expires is an ISO date or epoch milliseconds; it lasts until 2038 when left out.",
    {
      workspaceId: z.string(),
      domain: z.string().min(1),
      name: z.string().min(1),
      value: z.string(),
      path: z.string().default('/'),
      expires: z.union([z.string(), z.number()]).optional(),
      secure: z.boolean().default(false),
      httpOnly: z.boolean().default(false),
    },
    async ({ workspaceId, domain, name, value, path, expires, secure, httpOnly }) => {
      if (!await models.workspace.getById(workspaceId)) {
        return text({ error: 'workspace not found' }, true);
      }
      const when = expires === undefined ? MAX_TIME : new Date(expires).getTime();
      if (Number.isNaN(when)) {
        return text({ error: 'expires is not a date' }, true);
      }
      const jar = await models.cookieJar.getOrCreateForParentId(workspaceId);
      const existing = jar.cookies.find(cookie => sameCookie(cookie, domain, path, name));
      const cookie: Cookie = { ...existing, id: existing?.id || uuidv4(), key: name, value, domain, path, expires: new Date(when).toISOString(), secure, httpOnly };
      await models.cookieJar.update(jar, { cookies: existing ? jar.cookies.map(other => other === existing ? cookie : other) : [...jar.cookies, cookie] });
      return text({ ok: true, updated: !!existing, domain, path, name, expires: cookie.expires });
    },
  );

  server.tool(
    'delete_cookie',
    "Delete a cookie from a workspace's cookie jar by domain and name (and path, if several share the name).",
    { workspaceId: z.string(), domain: z.string(), name: z.string(), path: z.string().optional() },
    async ({ workspaceId, domain, name, path }) => {
      if (!await models.workspace.getById(workspaceId)) {
        return text({ error: 'workspace not found' }, true);
      }
      const jar = await models.cookieJar.getOrCreateForParentId(workspaceId);
      const matches = jar.cookies.filter(cookie => cookie.domain === domain && cookie.key === name && (path === undefined || cookie.path === path));
      if (!matches.length) {
        return text({ error: 'cookie not found' }, true);
      }
      if (matches.length > 1) {
        return text({ error: `${matches.length} cookies match: give path, one of ${matches.map(cookie => cookie.path).join(', ')}` }, true);
      }
      await models.cookieJar.update(jar, { cookies: jar.cookies.filter(cookie => cookie !== matches[0]) });
      return text({ ok: true, domain, path: matches[0].path, name });
    },
  );

  server.tool(
    'clear_cookies',
    "Delete ALL the cookies in a workspace's cookie jar, or all of one domain's. This cannot be undone.",
    { workspaceId: z.string(), domain: z.string().optional() },
    async ({ workspaceId, domain }) => {
      if (!await models.workspace.getById(workspaceId)) {
        return text({ error: 'workspace not found' }, true);
      }
      const jar = await models.cookieJar.getOrCreateForParentId(workspaceId);
      const kept = domain === undefined ? [] : jar.cookies.filter(cookie => cookie.domain !== domain);
      await models.cookieJar.update(jar, { cookies: kept });
      return text({ ok: true, deleted: jar.cookies.length - kept.length });
    },
  );
}
