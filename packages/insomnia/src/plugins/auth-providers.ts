// Auth from a plugin: a plugin's authProviders each add a kind of auth to the
// Auth menu, with the fields it asks for. A request keeps it as a strategy,
// { type: 'plugin', plugin, provider, ...its fields' values }, and before
// sending the provider's apply(context, values) changes the request, as a
// request hook does, with the values rendered:
//
//   module.exports.authProviders = [{
//     name: 'hmac', displayName: 'HMAC Signature',
//     fields: [{ name: 'keyId', label: 'Key ID' }, { name: 'secret', label: 'Secret', type: 'password' }],
//     apply: async (context, { keyId, secret }) => context.request.setHeader('Authorization', sign(keyId, secret, context.request)),
//   }];

export const AUTH_PLUGIN = 'plugin';

export interface AuthProviderField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  placeholder?: string;
  help?: string;
}

// what the app shows of a provider: data, no functions
export interface AuthProviderManifest {
  name: string;
  displayName: string;
  description: string;
  fields: AuthProviderField[];
}

// a strategy's own keys, which a field can't be named
const RESERVED = new Set(['type', 'plugin', 'provider', 'disabled', 'headerName']);
const PROVIDER_NAME = /^[A-Za-z][\w.-]{0,63}$/;
const FIELD_NAME = /^[A-Za-z][\w]{0,63}$/;
const MAX_FIELDS = 32;

const text = (value: unknown, limit = 2000) => (typeof value === 'string' ? value.slice(0, limit) : '');

// a provider as a plugin wrote it, as the app shows it; null when it can't be
// used (no name, or one that isn't a name)
export function providerManifestOf(provider: unknown): AuthProviderManifest | null {
  const given = provider as Record<string, unknown> | null;
  if (!given || typeof given !== 'object' || typeof given.name !== 'string' || !PROVIDER_NAME.test(given.name)) {
    return null;
  }
  const seen = new Set<string>();
  const fields = (Array.isArray(given.fields) ? given.fields : []).slice(0, MAX_FIELDS).flatMap((field): AuthProviderField[] => {
    const f = field as Record<string, unknown> | null;
    if (!f || typeof f.name !== 'string' || !FIELD_NAME.test(f.name) || RESERVED.has(f.name) || seen.has(f.name)) {
      return [];
    }
    seen.add(f.name);
    return [{
      name: f.name,
      label: text(f.label, 200) || f.name,
      type: f.type === 'password' || f.type === 'textarea' ? f.type : 'text',
      ...(text(f.placeholder, 200) ? { placeholder: text(f.placeholder, 200) } : {}),
      ...(text(f.help) ? { help: text(f.help) } : {}),
    }];
  });
  return {
    name: given.name,
    displayName: text(given.displayName, 200) || given.name,
    description: text(given.description),
    fields,
  };
}

// a new strategy for a provider
export const newPluginStrategy = (plugin: string, provider: AuthProviderManifest) => ({
  type: AUTH_PLUGIN,
  disabled: false,
  plugin,
  provider: provider.name,
  ...Object.fromEntries(provider.fields.map(field => [field.name, ''])),
});

// the values apply() gets: the provider's fields, from the (rendered) strategy
export const pluginAuthValues = (strategy: Record<string, unknown>, fields: AuthProviderField[]) =>
  Object.fromEntries(fields.map(field => [field.name, strategy[field.name] == null ? '' : String(strategy[field.name])]));

export const isPluginStrategy = (strategy: Record<string, unknown>) =>
  strategy.type === AUTH_PLUGIN && typeof strategy.plugin === 'string' && typeof strategy.provider === 'string';
