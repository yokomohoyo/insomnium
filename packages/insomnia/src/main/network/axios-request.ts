import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { isDevelopment } from '../../common/constants';
import * as models from '../../models';
import { proxyFor } from './proxy';
export const axiosRequest = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
  const settings = await models.settings.getOrCreate();

  const finalConfig: AxiosRequestConfig = {
    ...config,
    httpsAgent: new https.Agent({
      rejectUnauthorized: settings.validateSSL,
    }),
    // axios's own proxy support reads HTTP_PROXY and friends, and doesn't
    // tunnel to https; the agents below do both as the settings say
    proxy: false,
  };
  // hack for http-client
  const isArrayBuffer = Array.isArray(config.data) && config.responseType === 'arraybuffer';
  if (isArrayBuffer) {
    finalConfig.data = Buffer.concat(config.data);
  }
  const proxy = config.url ? await proxyFor(config.url, settings) : null;
  if (proxy) {
    const agent = proxy.startsWith('socks') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy);
    finalConfig.httpAgent = agent;
    finalConfig.httpsAgent = agent;
  }
  // HACK: workaround for isomteric git needing 400 responses
  if (config.responseType === 'arraybuffer') {
    console.log('[git-sync] Overriding validateStatus to allow 400 responses');
    finalConfig.validateStatus = status => status < 500;
  }
  const response = await axios(finalConfig);

  if (isDevelopment()) {
    console.log('[axios] Response', {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: !!response.data,
      config: {
        method: response.config.method,
        url: response.config.url,
        proxy: response.config.proxy,
        headers: response.config.headers,
      },
    });
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    data: response.data,
    config: {
      method: response.config.method,
      url: response.config.url,
      proxy: response.config.proxy,
      headers: response.config.headers,
    },
  };
};
