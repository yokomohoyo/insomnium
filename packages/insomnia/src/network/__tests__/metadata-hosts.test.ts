import { Curl } from '@getinsomnia/node-libcurl';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import dns from 'node:dns';
import { EventEmitter } from 'node:events';

import { globalBeforeEach } from '../../__jest__/before-each';
import { getRenderedRequestAndContext } from '../../common/render';
import { onWebSocketRedirect } from '../../main/network/websocket-redirect';
import * as models from '../../models';
import { assertNotMetadataHost, isMetadataHost, lookupRefusingMetadata, setMetadataGuard } from '../metadata-hosts';
import * as networkUtils from '../network';

const mockCurl = Curl as unknown as { addresses: Record<string, string> };

describe('cloud metadata hosts', () => {
  it.each([
    '169.254.169.254',
    '169.254.170.2',
    '169.254.1.1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '[::ffff:a9fe:aa02]',
    'fe80::1',
    'fd00:ec2::254',
    'metadata.google.internal',
    'Metadata.Google.Internal.',
    'metadata',
  ])('%s is one', host => {
    expect(isMetadataHost(host)).toBe(true);
  });

  it.each(['127.0.0.1', '10.0.0.5', '169.255.0.1', '::1', 'api.example.com', 'metadata.example.com'])('%s is not', host => {
    expect(isMetadataHost(host)).toBe(false);
  });

  describe('names that resolve to one', () => {
    afterEach(() => jest.restoreAllMocks());

    it('are refused before a connection that resolves its own names', async () => {
      jest.spyOn(dns.promises, 'lookup').mockImplementation((async (name: string) => [{ address: name === 'rebind.example.com' ? '169.254.169.254' : '93.184.215.14', family: 4 }]) as any);
      await expect(assertNotMetadataHost('rebind.example.com')).rejects.toThrow('rebind.example.com: it resolves to 169.254.169.254');
      await expect(assertNotMetadataHost('api.example.com')).resolves.toBeUndefined();
      await expect(assertNotMetadataHost('169.254.170.2')).rejects.toThrow('cloud metadata');
    });

    it('fail a socket lookup', async () => {
      jest.spyOn(dns, 'lookup').mockImplementation(((name: string, _options: unknown, callback: (...args: unknown[]) => void) =>
        callback(null, [{ address: name === 'rebind.example.com' ? '169.254.170.2' : '93.184.215.14', family: 4 }])) as any);
      const lookup = (name: string, options: dns.LookupOptions) => new Promise((resolve, reject) =>
        (lookupRefusingMetadata as any)(name, options, (err: Error | null, ...rest: unknown[]) => err ? reject(err) : resolve(rest)));

      await expect(lookup('rebind.example.com', {})).rejects.toThrow('it resolves to 169.254.170.2');
      await expect(lookup('api.example.com', {})).resolves.toEqual(['93.184.215.14', 4]);
      await expect(lookup('api.example.com', { all: true })).resolves.toEqual([[{ address: '93.184.215.14', family: 4 }]]);
    });
  });

  describe('for an MCP client', () => {
    beforeEach(async () => {
      await globalBeforeEach();
      await models.project.all();
    });
    afterEach(() => {
      setMetadataGuard(() => false);
      mockCurl.addresses = {};
    });

    const send = async (url: string) => {
      const workspace = await models.workspace.create();
      const settings = await models.settings.getOrCreate();
      const request = Object.assign(models.request.init(), { _id: 'req_123', parentId: workspace._id, url });
      const { request: rendered } = await getRenderedRequestAndContext({ request });
      return networkUtils.sendCurlAndWriteTimeline(rendered, [], null, settings);
    };

    it('no HTTP request connects to one, whatever name leads there', async () => {
      setMetadataGuard(() => true);
      await expect(send('http://169.254.170.2/v2/credentials')).rejects.toThrow('cloud metadata');

      mockCurl.addresses['rebind.example.com'] = '169.254.169.254';
      expect(await send('http://rebind.example.com/latest/meta-data/')).toMatchObject({ error: 'Refusing to connect to 169.254.169.254: cloud metadata addresses are blocked' });
      expect((await send('http://api.example.com/')).statusCode).toBe(200);
    });

    it('while the app itself may', async () => {
      mockCurl.addresses['rebind.example.com'] = '169.254.169.254';
      expect((await send('http://rebind.example.com/')).statusCode).toBe(200);
    });
  });
});

describe('a WebSocket redirect', () => {
  const redirect = (from: string, to: string, refuseMetadata = false) => {
    const ws = new EventEmitter();
    onWebSocketRedirect(ws as any, from, { refuseMetadata });
    const headers: Record<string, string> = { authorization: 'Bearer t', cookie: 'a=b', host: new URL(from).host };
    const request = {
      destroyed: undefined as Error | undefined,
      removeHeader: (name: string) => delete headers[name],
      getHeader: (name: string) => headers[name],
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      destroy(err: Error) {
        this.destroyed = err;
      },
    };
    ws.emit('redirect', to, request);
    return { headers, destroyed: request.destroyed };
  };

  it('keeps credentials on the same host, as ws does', () => {
    expect(redirect('wss://api.example.com/a', 'wss://api.example.com/b').headers).toEqual({ authorization: 'Bearer t', cookie: 'a=b', host: 'api.example.com' });
  });

  it('drops them for another host, or from wss to ws', () => {
    expect(redirect('wss://api.example.com/a', 'wss://other.example.com/').headers).toEqual({ host: 'other.example.com' });
    expect(redirect('wss://api.example.com/a', 'ws://api.example.com/').headers).toEqual({ host: 'api.example.com' });
  });

  it('to a metadata address, is refused for an MCP client', () => {
    expect(redirect('ws://api.example.com/', 'ws://169.254.169.254/', true).destroyed?.message).toMatch('cloud metadata');
    expect(redirect('ws://api.example.com/', 'ws://169.254.169.254/').destroyed).toBeUndefined();
  });
});
