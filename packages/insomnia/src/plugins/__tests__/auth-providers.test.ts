import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { tryToTransformRequestWithPlugins } from '../../network/network';
import { isPluginStrategy, newPluginStrategy, pluginAuthValues, providerManifestOf } from '../auth-providers';
import * as pluginsModule from '../index';

// what the app does with a request's plugin auth goes through the plugins' list
jest.mock('../index', () => ({
  getAuthProviders: jest.fn(),
  getRequestHooks: jest.fn(),
}));

describe('a plugin auth provider', () => {
  it('is shown with the fields it asks for, as data', () => {
    expect(providerManifestOf({
      name: 'hmac',
      displayName: 'HMAC Signature',
      description: 'Signs each request',
      fields: [
        { name: 'keyId', label: 'Key ID', placeholder: 'k-1' },
        { name: 'secret', label: 'Secret', type: 'password', help: 'never shown' },
        { name: 'pem', type: 'textarea' },
        { name: 'other', type: 'checkbox' },
      ],
      apply: () => {},
    })).toEqual({
      name: 'hmac',
      displayName: 'HMAC Signature',
      description: 'Signs each request',
      fields: [
        { name: 'keyId', label: 'Key ID', type: 'text', placeholder: 'k-1' },
        { name: 'secret', label: 'Secret', type: 'password', help: 'never shown' },
        { name: 'pem', label: 'pem', type: 'textarea' },
        { name: 'other', label: 'other', type: 'text' },
      ],
    });
  });

  it("leaves out fields named as the strategy's own keys, twice, or not as names", () => {
    const fields = providerManifestOf({ name: 'x', fields: [{ name: 'type' }, { name: 'plugin' }, { name: 'disabled' }, { name: 'a b' }, { name: 'ok' }, { name: 'ok' }, null] })!.fields;
    expect(fields.map(field => field.name)).toEqual(['ok']);
  });

  it("isn't one without a name that is a name", () => {
    expect(providerManifestOf({ displayName: 'nameless' })).toBeNull();
    expect(providerManifestOf({ name: 'has space' })).toBeNull();
    expect(providerManifestOf(null)).toBeNull();
  });

  it('becomes a strategy, and gives apply() its values as text', () => {
    const provider = providerManifestOf({ name: 'hmac', fields: [{ name: 'keyId' }, { name: 'secret' }] })!;
    const strategy = newPluginStrategy('insomnia-plugin-hmac', provider);
    expect(strategy).toEqual({ type: 'plugin', disabled: false, plugin: 'insomnia-plugin-hmac', provider: 'hmac', keyId: '', secret: '' });
    expect(isPluginStrategy(strategy)).toBe(true);
    expect(isPluginStrategy({ type: 'plugin' })).toBe(false);
    expect(pluginAuthValues({ ...strategy, keyId: 'k-1', secret: 42, extra: 'not a field' }, provider.fields)).toEqual({ keyId: 'k-1', secret: '42' });
  });
});

describe('a request with plugin auth, before sending', () => {
  // set again for each test: the preset resets mocks
  const plugins = pluginsModule as unknown as Record<string, jest.Mock<any>>;
  beforeEach(() => {
    plugins.getRequestHooks.mockResolvedValue([]);
  });
  const send = async (authentication: unknown) => {
    const request = { _id: 'req_1', url: 'https://api.example.com', method: 'GET', headers: [], parameters: [], body: {}, authentication } as any;
    return tryToTransformRequestWithPlugins({ request, context: { getProjectId: () => 'proj_1' } as any });
  };
  const plugin = { name: 'insomnia-plugin-hmac', directory: '', config: { disabled: false } };

  it("has each enabled strategy's provider apply its values", async () => {
    const apply = jest.fn(async (context: any, values: Record<string, string>) => {
      context.request.setHeader('Authorization', `HMAC ${values.keyId}`);
    });
    plugins.getAuthProviders.mockResolvedValue([{ plugin, provider: providerManifestOf({ name: 'hmac', fields: [{ name: 'keyId' }] }), apply }]);

    const sent = await send([
      { type: 'plugin', plugin: 'insomnia-plugin-hmac', provider: 'hmac', keyId: 'k-1' },
      { type: 'plugin', plugin: 'insomnia-plugin-hmac', provider: 'hmac', keyId: 'off', disabled: true },
    ]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1]).toEqual({ keyId: 'k-1' });
    expect(sent.headers).toEqual([{ name: 'Authorization', value: 'HMAC k-1' }]);
  });

  it("says so when the plugin isn't there", async () => {
    plugins.getAuthProviders.mockResolvedValue([]);
    await expect(send({ type: 'plugin', plugin: 'gone', provider: 'hmac' })).rejects.toThrow('comes from the plugin gone');
  });
});
