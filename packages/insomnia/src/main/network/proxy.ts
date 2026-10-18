import type { ChannelOptions } from '@grpc/grpc-js';
import electron from 'electron';
import { env as processEnv } from 'node:process';

import type { Settings } from '../../models/settings';
import { setDefaultProtocol } from '../../utils/url/protocol';

type ProxySettings = Pick<Settings, 'proxyEnabled' | 'httpProxy' | 'httpsProxy' | 'noProxy'> & { useSystemProxy?: boolean };

const isSecure = (protocol: string) => ['https:', 'wss:', 'grpcs:'].includes(protocol);

// NO_PROXY's rules, as curl reads them: comma-separated hosts, each covering
// itself and its subdomains (a leading . or *. is the same), optionally with a
// port; * covers everything
export const bypassesProxy = (host: string, port: string, noProxy: string) => {
  const name = host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return noProxy.split(/[\s,]+/).filter(Boolean).some(rule => {
    const [ruleHost, rulePort] = rule.toLowerCase().split(/:(?=\d+$)/);
    if (rulePort && rulePort !== port) {
      return false;
    }
    if (ruleHost === '*') {
      return true;
    }
    const bare = ruleHost.replace(/^\*?\./, '');
    return name === bare || name.endsWith(`.${bare}`);
  });
};

// The first proxy in Chromium's answer ("PROXY a:8080; DIRECT"), or none
export const fromResolvedProxy = (result: string): string | null => {
  for (const entry of result.split(';').map(part => part.trim()).filter(Boolean)) {
    const [kind, address] = entry.split(/\s+/);
    switch (kind.toUpperCase()) {
      case 'DIRECT':
        return null;
      case 'PROXY':
        return `http://${address}`;
      case 'HTTPS':
        return `https://${address}`;
      case 'SOCKS':
      case 'SOCKS5':
        return `socks5://${address}`;
      case 'SOCKS4':
        return `socks4://${address}`;
      default:
        continue;
    }
  }
  return null;
};

const fromEnvironment = (url: URL, env: Record<string, string | undefined>) => {
  const noProxy = env.NO_PROXY ?? env.no_proxy ?? '';
  if (bypassesProxy(url.hostname, url.port, noProxy)) {
    return null;
  }
  const proxy = isSecure(url.protocol)
    ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
    : env.HTTP_PROXY ?? env.http_proxy;
  return proxy ? setDefaultProtocol(proxy) : null;
};

// The proxy a connection to `target` goes through, or null to go direct: the
// one set in Preferences, else, when asked, the system's. That's the OS
// settings (and PAC file) as Chromium resolves them in the app, or
// HTTP(S)_PROXY and NO_PROXY without Electron (the headless server).
export async function proxyFor(target: string, settings: ProxySettings, env: Record<string, string | undefined> = processEnv): Promise<string | null> {
  const url = new URL(target);
  if (settings.proxyEnabled) {
    if (settings.noProxy && bypassesProxy(url.hostname, url.port, settings.noProxy)) {
      return null;
    }
    // a secure connection uses the HTTP proxy when there's no HTTPS one
    const proxy = isSecure(url.protocol) ? settings.httpsProxy || settings.httpProxy : settings.httpProxy;
    return proxy ? setDefaultProtocol(proxy) : null;
  }
  if (!settings.useSystemProxy) {
    return null;
  }
  const session = electron.session?.defaultSession;
  if (session?.resolveProxy) {
    // Chromium resolves for http and https
    const scheme = isSecure(url.protocol) ? 'https' : 'http';
    return fromResolvedProxy(await session.resolveProxy(`${scheme}://${url.host}/`));
  }
  return fromEnvironment(url, env);
}

// The proxy for a timeline, without its password
export const describeProxy = (proxy: string) => {
  try {
    const url = new URL(proxy);
    if (url.password) {
      url.password = '****';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return proxy;
  }
};

// grpc-js takes its proxy only from the environment, as it makes a channel, so
// it's set there just for that; and when there's none, an inherited
// http_proxy mustn't apply either. It supports HTTP proxies only.
export async function makeGrpcClient<T>(target: string, secure: boolean, settings: ProxySettings, make: (options: ChannelOptions) => T, env: Record<string, string | undefined> = processEnv): Promise<T> {
  const proxy = await proxyFor(`${secure ? 'https' : 'http'}://${target}`, settings, env);
  if (!proxy || !proxy.startsWith('http://')) {
    if (proxy) {
      console.warn(`[grpc] Connecting directly to ${target}: gRPC can only go through an HTTP proxy, not ${describeProxy(proxy)}`);
    }
    return make({ 'grpc.enable_http_proxy': 0 });
  }
  const saved = { grpc_proxy: env.grpc_proxy, no_grpc_proxy: env.no_grpc_proxy };
  env.grpc_proxy = proxy;
  // proxyFor already applied the bypass list; a no_proxy from the environment mustn't again
  env.no_grpc_proxy = 'insomnium.invalid';
  try {
    return make({});
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete env[name];
      } else {
        env[name] = value;
      }
    }
  }
}
