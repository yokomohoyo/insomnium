// OAuth 2.0 sign-in in the system browser rather than a window of the app
// (RFC 8252, OAuth for native apps): for providers that block embedded windows,
// and for SSO and passkeys that live in the browser. A server on a loopback
// address takes the redirect: the provider must allow that redirect URL, and
// with no port in it, any free port is used, as RFC 8252 asks providers to
// accept. The server answers only the redirect's path, then closes.
import http from 'node:http';

import { shell } from 'electron';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const TIMEOUT_MS = 5 * 60 * 1000;

const SIGNED_IN = `<!doctype html><meta charset="utf-8"><title>Insomnium</title>
<body style="font-family: system-ui, sans-serif; margin: 4rem; text-align: center">
<h1>Done</h1><p>You can close this tab and go back to Insomnium.</p></body>`;

export function loopbackRedirect(redirectUrl: string) {
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    throw new Error(`To sign in with the system browser, the redirect URL has to be a loopback address such as http://127.0.0.1:8484/callback, not "${redirectUrl}"`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`To sign in with the system browser, the redirect URL has to be a loopback address such as http://127.0.0.1:8484/callback, not ${url.origin}`);
  }
  return url;
}

export async function authorizeInSystemBrowser(
  { url, redirectUrl, timeoutMs = TIMEOUT_MS }: { url: string; redirectUrl: string; timeoutMs?: number },
  // the authorization URL is checked to be http(s) before it's opened
  // eslint-disable-next-line no-restricted-properties
  open: (url: string) => Promise<unknown> = target => shell.openExternal(target),
): Promise<{ redirectedTo: string; redirectUri: string }> {
  const redirect = loopbackRedirect(redirectUrl);
  const authorization = new URL(url);
  if (authorization.protocol !== 'https:' && authorization.protocol !== 'http:') {
    throw new Error('The authorization URL has to be http or https');
  }

  return new Promise((resolve, reject) => {
    // as typed when it has a port, so it matches what the provider has registered
    let redirectUri = redirectUrl;
    let settled = false;
    const finish = (settle: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        server.close();
        settle();
      }
    };

    const server = http.createServer((request, response) => {
      const received = new URL(request.url || '/', redirectUri);
      if (received.pathname !== redirect.pathname || !(received.searchParams.has('code') || received.searchParams.has('error'))) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(SIGNED_IN);
      finish(() => resolve({ redirectedTo: received.toString(), redirectUri }));
    });
    const timer = setTimeout(() => finish(() => reject(new Error('Signing in with the system browser timed out'))), timeoutMs);
    server.on('error', error => finish(() => reject(error)));

    const host = redirect.hostname === '[::1]' ? '::1' : redirect.hostname;
    server.listen(Number(redirect.port) || 0, host, () => {
      const address = server.address();
      if (!redirect.port && address && typeof address === 'object') {
        const withPort = new URL(redirect.toString());
        withPort.port = String(address.port);
        redirectUri = withPort.toString();
      }
      authorization.searchParams.set('redirect_uri', redirectUri);
      open(authorization.toString()).catch(error => finish(() => reject(error)));
    });
  });
}
