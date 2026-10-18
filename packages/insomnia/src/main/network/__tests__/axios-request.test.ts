import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { axiosRequest } from '../axios-request';

interface AxiosRequestMockUserSettings {
  // mocking only what we need to run axiosRequest
  proxyEnabled: boolean;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
  validateSSL: boolean;
  useSystemProxy?: boolean;
}

jest.mock('axios');
jest.spyOn(models.settings, 'getOrCreate');

describe('axiosRequest used for git-sync', () => {
  beforeEach(globalBeforeEach);

  describe('proxy behavior should match the same UX from rest client behavior', () => {
    beforeEach(() => {
      globalBeforeEach();
      // we want to test that the values that are passed to axios are returned in the config key
      (axios as unknown as jest.Mock).mockImplementation(ajaxConfig => Promise.resolve({
        config: ajaxConfig,
        data: {},
        headers: {},
        request: {},
        status: 200,
        statusText: 'OK',
      }));
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    // the config axios was called with (axiosRequest returns a trimmed copy)
    const send = async (url: string, settings: AxiosRequestMockUserSettings) => {
      (models.settings.getOrCreate as unknown as jest.Mock).mockImplementation(() => settings);
      await axiosRequest({ url });
      const { calls } = (axios as unknown as jest.Mock).mock;
      return calls[calls.length - 1][0] as AxiosRequestConfig;
    };
    // the proxy an agent goes through
    const proxyOf = (agent: unknown) => agent instanceof HttpsProxyAgent ? agent.proxy.href : null;

    it("never uses axios's own proxy support, and goes direct with the proxy off", async () => {
      const config = await send('https://git.acme.com/username/repo-name.git/git-upload-pack', {
        proxyEnabled: false,
        httpsProxy: 'https://some.proxy.com:8080',
        httpProxy: 'https://some.proxy.com:8080',
        noProxy: '',
        validateSSL: false,
      });
      expect(config.proxy).toBe(false);
      expect(proxyOf(config.httpsAgent)).toBeNull();
    });

    it('tunnels through the proxy for the scheme, falling back to the HTTP one for https', async () => {
      const settings = { proxyEnabled: true, httpsProxy: '', httpProxy: 'https://some.proxy.com:8080', noProxy: 'localhost,127.0.0.1', validateSSL: false };
      expect(proxyOf((await send('http://git.acme.com/repo.git/git-upload-pack', settings)).httpAgent)).toBe('https://some.proxy.com:8080/');
      expect(proxyOf((await send('https://git.acme.com/repo.git/git-upload-pack', settings)).httpsAgent)).toBe('https://some.proxy.com:8080/');

      const both = { ...settings, httpsProxy: 'https://secure.proxy.com:8443' };
      expect(proxyOf((await send('https://git.acme.com/repo.git/git-upload-pack', both)).httpsAgent)).toBe('https://secure.proxy.com:8443/');
      expect(proxyOf((await send('http://git.acme.com/repo.git/git-upload-pack', both)).httpAgent)).toBe('https://some.proxy.com:8080/');
    });

    it('goes direct for the hosts the no-proxy list names, or with no proxy for the scheme', async () => {
      const settings = { proxyEnabled: true, httpsProxy: 'https://some.proxy.com:8080', httpProxy: '', noProxy: 'localhost,127.0.0.1', validateSSL: false };
      expect(proxyOf((await send('http://git.acme.com/repo.git/git-upload-pack', settings)).httpAgent)).toBeNull();
      expect(proxyOf((await send('https://localhost/repo.git/git-upload-pack', settings)).httpsAgent)).toBeNull();
    });

    it('uses a SOCKS agent for a SOCKS proxy', async () => {
      const config = await send('https://git.acme.com/repo.git/git-upload-pack', { proxyEnabled: true, httpsProxy: 'socks5://socks.acme.com:1080', httpProxy: '', noProxy: '', validateSSL: true });
      expect(config.httpsAgent).toBeInstanceOf(SocksProxyAgent);
    });

    it("uses the environment's proxy when the system proxy is on (no Electron here)", async () => {
      const previous = process.env.HTTPS_PROXY;
      process.env.HTTPS_PROXY = 'http://env.proxy.com:3128';
      try {
        const config = await send('https://git.acme.com/repo.git/git-upload-pack', { proxyEnabled: false, httpsProxy: '', httpProxy: '', noProxy: '', validateSSL: true, useSystemProxy: true });
        expect(proxyOf(config.httpsAgent)).toBe('http://env.proxy.com:3128/');
      } finally {
        if (previous === undefined) {
          delete process.env.HTTPS_PROXY;
        } else {
          process.env.HTTPS_PROXY = previous;
        }
      }
    });
  });
});
