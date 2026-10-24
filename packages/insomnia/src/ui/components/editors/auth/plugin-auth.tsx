import React, { FC, useEffect, useState } from 'react';

import { t } from '../../../../common/i18n';
import type { AuthProviderManifest } from '../../../../plugins/auth-providers';
import { getAuthProviders } from '../../../../plugins/index';
import { useAuthStrategy } from './auth-strategy-context';
import { AuthInputRow } from './components/auth-input-row';
import { AuthPrivateKeyRow } from './components/auth-private-key-row';
import { AuthTableBody } from './components/auth-table-body';
import { AuthToggleRow } from './components/auth-toggle-row';

export interface ProvidedAuth {
  plugin: string;
  provider: AuthProviderManifest;
}

// the kinds of auth the active plugins add (plugins/auth-providers.ts)
export const useAuthProviders = () => {
  const [providers, setProviders] = useState<ProvidedAuth[]>([]);
  useEffect(() => {
    let mounted = true;
    getAuthProviders()
      .then(found => mounted && setProviders(found.map(({ plugin, provider }) => ({ plugin: plugin.name, provider }))))
      .catch(err => console.warn('[plugins] Could not list auth providers', err));
    return () => {
      mounted = false;
    };
  }, []);
  return providers;
};

// a plugin's auth: the fields its provider asks for
export const PluginAuth: FC = () => {
  const { strategy } = useAuthStrategy();
  const providers = useAuthProviders();
  const found = providers.find(({ plugin, provider }) => plugin === strategy.plugin && provider.name === strategy.provider);

  if (!found) {
    return (
      <div className="pad super-faint text-sm">
        {t('This auth comes from the plugin {plugin}, which isn\'t installed or is turned off.', { plugin: String(strategy.plugin) })}
      </div>
    );
  }
  return (
    <AuthTableBody>
      <AuthToggleRow label="Enabled" property="disabled" invert />
      {found.provider.description && <tr><td colSpan={2} className="pad-left faint txt-sm">{found.provider.description}</td></tr>}
      {found.provider.fields.map(field => field.type === 'textarea'
        ? <AuthPrivateKeyRow key={field.name} label={field.label} property={field.name} help={field.help} />
        : <AuthInputRow key={field.name} label={field.label} property={field.name} help={field.help} mask={field.type === 'password'} />)}
    </AuthTableBody>
  );
};
