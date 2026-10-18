import { afterEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';

import { bypassesProxy, describeProxy, fromResolvedProxy, makeGrpcClient, proxyFor } from '../proxy';

jest.mock('electron');

const off = { proxyEnabled: false, httpProxy: '', httpsProxy: '', noProxy: '', useSystemProxy: false };
const manual = { ...off, proxyEnabled: true, httpProxy: 'proxy.corp:3128', httpsProxy: 'https://secure.corp:3129', noProxy: 'localhost,.internal.corp' };

describe('bypassesProxy()', () => {
  it('matches hosts and their subdomains, ports and *, as curl does', () => {
    const list = 'localhost, example.com, .internal.corp, *.lan, 10.0.0.5:8080';
    expect(bypassesProxy('localhost', '', list)).toBe(true);
    expect(bypassesProxy('api.example.com', '', list)).toBe(true);
    expect(bypassesProxy('notexample.com', '', list)).toBe(false);
    expect(bypassesProxy('a.internal.corp', '443', list)).toBe(true);
    expect(bypassesProxy('printer.lan', '', list)).toBe(true);
    expect(bypassesProxy('10.0.0.5', '8080', list)).toBe(true);
    expect(bypassesProxy('10.0.0.5', '9090', list)).toBe(false);
    expect(bypassesProxy('anything', '', '*')).toBe(true);
    expect(bypassesProxy('anything', '', '')).toBe(false);
  });
});

describe('fromResolvedProxy()', () => {
  it("takes the first proxy in Chromium's answer", () => {
    expect(fromResolvedProxy('DIRECT')).toBeNull();
    expect(fromResolvedProxy('PROXY corp:3128; DIRECT')).toBe('http://corp:3128');
    expect(fromResolvedProxy('HTTPS corp:443')).toBe('https://corp:443');
    expect(fromResolvedProxy('SOCKS5 corp:1080')).toBe('socks5://corp:1080');
    expect(fromResolvedProxy('QUIC x:1; SOCKS4 corp:1080')).toBe('socks4://corp:1080');
    expect(fromResolvedProxy('')).toBeNull();
  });
});

describe('proxyFor()', () => {
  afterEach(() => {
    // @ts-expect-error -- the mock has no session; one test adds it
    delete electron.session;
  });

  it("uses Preferences' proxy for the scheme, except for the hosts it leaves out", async () => {
    expect(await proxyFor('http://api.example.com/', manual)).toBe('http://proxy.corp:3128');
    expect(await proxyFor('wss://api.example.com/socket', manual)).toBe('https://secure.corp:3129');
    expect(await proxyFor('ws://localhost:8080/', manual)).toBeNull();
    expect(await proxyFor('https://db.internal.corp/', manual)).toBeNull();
  });

  it("goes direct when it's off, even with a proxy in the environment", async () => {
    expect(await proxyFor('https://api.example.com/', off, { HTTPS_PROXY: 'http://env:3128' })).toBeNull();
  });

  it("uses the environment's when asked, without Electron (the headless server)", async () => {
    const system = { ...off, useSystemProxy: true };
    const env = { HTTPS_PROXY: 'http://secure-env:3128', http_proxy: 'env:3128', NO_PROXY: 'localhost' };
    expect(await proxyFor('https://api.example.com/', system, env)).toBe('http://secure-env:3128');
    expect(await proxyFor('ws://api.example.com/', system, env)).toBe('http://env:3128');
    expect(await proxyFor('http://localhost:4010/', system, env)).toBeNull();
    expect(await proxyFor('http://api.example.com/', system, {})).toBeNull();
  });

  it("asks Chromium in the app, which knows the OS's settings and PAC file", async () => {
    const resolveProxy = jest.fn(async () => 'PROXY os-proxy:8080; DIRECT');
    // @ts-expect-error -- just the part used
    electron.session = { defaultSession: { resolveProxy } };
    expect(await proxyFor('wss://api.example.com/socket', { ...off, useSystemProxy: true }, { HTTPS_PROXY: 'http://ignored:1' })).toBe('http://os-proxy:8080');
    expect(resolveProxy).toHaveBeenCalledWith('https://api.example.com/');
  });
});

describe('makeGrpcClient()', () => {
  it('sets the proxy in the environment just while the client is made', async () => {
    const env: Record<string, string | undefined> = { no_proxy: 'grpc.example.com' };
    const seen = await makeGrpcClient('grpc.example.com:443', true, { ...manual, httpsProxy: 'http://secure.corp:3129' }, options => ({ options, grpc_proxy: env.grpc_proxy, no_grpc_proxy: env.no_grpc_proxy }), env);
    expect(seen).toEqual({ options: {}, grpc_proxy: 'http://secure.corp:3129', no_grpc_proxy: 'insomnium.invalid' });
    expect(env).toEqual({ no_proxy: 'grpc.example.com' });
  });

  it('turns off the environment proxy when there is none, or when it is not HTTP', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await makeGrpcClient('grpc.example.com:443', true, off, options => options, { grpc_proxy: 'http://env:3128' })).toEqual({ 'grpc.enable_http_proxy': 0 });
    expect(await makeGrpcClient('grpc.example.com:80', false, { ...manual, httpProxy: 'socks5://corp:1080' }, options => options)).toEqual({ 'grpc.enable_http_proxy': 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/can only go through an HTTP proxy, not socks5:\/\/corp:1080/));
    warn.mockRestore();
  });
});

describe('describeProxy()', () => {
  it('hides the password', () => {
    expect(describeProxy('http://me:s3cret@corp:3128')).toBe('http://me:****@corp:3128');
    expect(describeProxy('http://corp:3128')).toBe('http://corp:3128');
  });
});
