/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { authorizeInSystemBrowser, loopbackRedirect } from '../authorize-in-system-browser';

// a browser that follows the authorization URL to the provider, which redirects back with a code
const browser = (query: string) => async (url: string) => {
  const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
  const response = await fetch(`${redirectUri}?${query}`);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('go back to Insomnium');
};

describe('authorizeInSystemBrowser()', () => {
  it('takes the redirect on a free loopback port when the URL has none', async () => {
    const { redirectedTo, redirectUri } = await authorizeInSystemBrowser(
      { url: 'https://auth.example.com/authorize?client_id=me', redirectUrl: 'http://127.0.0.1/callback' },
      browser('code=abc&state=xyz'),
    );

    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(new URL(redirectedTo).searchParams.get('code')).toBe('abc');
    expect(new URL(redirectedTo).searchParams.get('state')).toBe('xyz');
  });

  it('keeps a redirect URL with a port as it was typed', async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const { redirectUri } = await authorizeInSystemBrowser(
      { url: 'https://auth.example.com/authorize', redirectUrl: `http://127.0.0.1:${port}/cb` },
      browser('error=access_denied'),
    );

    expect(redirectUri).toBe(`http://127.0.0.1:${port}/cb`);
  });

  it('answers only the redirect path, with a code or an error', async () => {
    const result = authorizeInSystemBrowser(
      { url: 'https://auth.example.com/authorize', redirectUrl: 'http://127.0.0.1/callback' },
      async url => {
        const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
        const origin = new URL(redirectUri).origin;
        expect((await fetch(`${origin}/other?code=abc`)).status).toBe(404);
        expect((await fetch(redirectUri)).status).toBe(404);
        await fetch(`${redirectUri}?code=real`);
      },
    );

    expect(new URL((await result).redirectedTo).searchParams.get('code')).toBe('real');
  });

  it('gives up after a while', async () => {
    await expect(authorizeInSystemBrowser(
      { url: 'https://auth.example.com/authorize', redirectUrl: 'http://127.0.0.1/callback', timeoutMs: 50 },
      async () => undefined,
    )).rejects.toThrow('timed out');
  });

  it('needs a loopback redirect URL and an http(s) authorization URL', async () => {
    expect(() => loopbackRedirect('https://app.example.com/callback')).toThrow('loopback address');
    expect(() => loopbackRedirect('http://192.168.1.2:8484/callback')).toThrow('loopback address');
    expect(() => loopbackRedirect('not a url')).toThrow('loopback address');
    expect(loopbackRedirect('http://localhost:8484/cb').port).toBe('8484');
    await expect(authorizeInSystemBrowser({ url: 'file:///etc/passwd', redirectUrl: 'http://127.0.0.1/cb' }, async () => undefined)).rejects.toThrow('http or https');
  });
});
