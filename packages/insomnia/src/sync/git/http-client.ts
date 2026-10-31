import { isSshTransportUrl, SSH_KEY_HEADER, SSH_PASSPHRASE_HEADER } from './ssh-url';

const collect = async (body: AsyncIterable<Uint8Array> | Uint8Array[] | undefined) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body || []) {
    chunks.push(chunk);
  }
  const all = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
};

// how a request leaves: the main process's SSH and HTTP (main/git-ssh, axios-request)
export interface GitTransport {
  gitSshRequest: Window['main']['gitSshRequest'];
  axiosRequest: Window['main']['axiosRequest'];
}

/** A client for isomorphic-git {@link https://isomorphic-git.org/docs/en/http}, over a transport */
export const makeHttpClient = (transport: () => GitTransport) => ({
  request: async (config: any) => {
    // an SSH remote (ssh-url.ts), which the main process speaks to over SSH
    if (isSshTransportUrl(config.url)) {
      const response = await transport().gitSshRequest({
        url: config.url,
        method: config.method,
        headers: config.headers || {},
        body: config.method === 'POST' ? await collect(config.body) : undefined,
      });
      return {
        url: config.url,
        method: config.method,
        headers: response.headers,
        body: [response.body],
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
      };
    }
    // an SSH key's settings are for an SSH remote only
    const headers = { ...config.headers };
    delete headers[SSH_KEY_HEADER];
    delete headers[SSH_PASSPHRASE_HEADER];
    if (!headers.Accept) {
      headers.Accept = '*/*';
    }
    // hosted-git-info was adding git+ to the beginning of the url which isn't supported by axios after 0.27.0
    const withoutGitPlus = config.url.replace(/^git\+/, '');
    const response = await transport().axiosRequest({
      url: withoutGitPlus,
      method: config.method,
      headers,
      data: config.body,
      responseType: 'arraybuffer',
      maxRedirects: 10,
    });
    return {
      url: config.url,
      method: config.method,
      headers: response.headers as Record<string, string>,
      body: [response.data],
      statusCode: response.status,
      statusMessage: response.statusText,
    };
  },
});

// the window's, through the main process
export const httpClient = makeHttpClient(() => window.main);
