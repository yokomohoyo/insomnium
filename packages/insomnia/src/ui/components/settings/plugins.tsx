import { env as processEnv } from 'node:process';
import * as path from 'path';
import React, { FC, useEffect, useState } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import {
  NPM_PACKAGE_BASE,
  PLUGIN_SEARCH_URL,
} from '../../../common/constants';
import { docsPlugins } from '../../../common/documentation';
import { t } from '../../../common/i18n';
import { tx } from '../../tx';
import { selectFileOrFolder } from '../../../common/select-file-or-folder';
import * as models from '../../../models';
import { createPlugin } from '../../../plugins/create';
import type { Plugin } from '../../../plugins/index';
import { getPlugins } from '../../../plugins/index';
import { reload } from '../../../templating/index';
import { useSettingsPatcher } from '../../hooks/use-request';
import { RootLoaderData } from '../../routes/root';
import { CopyButton } from '../base/copy-button';
import { Link } from '../base/link';
import { HelpTooltip } from '../help-tooltip';
import { showAlert, showModal, showPrompt } from '../modals';
import { AskModal } from '../modals/ask-modal';
import { Button } from '../themed-button';
import { TextSetting } from './text-setting';
interface State {
  plugins: Plugin[];
  npmPluginValue: string;
  error: Error | null;
  installPluginErrMsg: string;
  isInstallingFromNpm: boolean;
  isRefreshingPlugins: boolean;
}
export const Plugins: FC = () => {
  const [state, setState] = useState<State>({
    plugins: [],
    npmPluginValue: '',
    error: null,
    installPluginErrMsg: '',
    isInstallingFromNpm: false,
    isRefreshingPlugins: false,
  });
  const {
    plugins,
    error,
    installPluginErrMsg,
    isInstallingFromNpm,
    isRefreshingPlugins,
    npmPluginValue,
  } = state;
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;

  useEffect(() => {
    refreshPlugins();
  }, []);

  async function refreshPlugins() {
    setState(state => ({ ...state, isRefreshingPlugins: true }));
    // Get and reload plugins
    const plugins = await getPlugins(true);
    reload();

    setState(state => ({ ...state, plugins, isRefreshingPlugins: false }));
  }
  const patchSettings = useSettingsPatcher();

  // a plugin with full access runs with Node.js, as the app does; others in a sandbox
  const setFullAccess = async (plugin: Plugin, fullAccess: boolean) => {
    const apply = async () => {
      setState(state => ({ ...state, isRefreshingPlugins: true }));
      const { pluginConfig } = await models.settings.getOrCreate();
      // for this folder's plugin: another of its name elsewhere stays sandboxed
      await models.settings.patch({ pluginConfig: { ...pluginConfig, [plugin.name]: { ...plugin.config, fullAccess, fullAccessDirectory: fullAccess ? plugin.directory : undefined } } });
      await refreshPlugins();
    };
    if (!fullAccess) {
      return apply();
    }
    showModal(AskModal, {
      title: t('Allow {name} full access?', { name: plugin.name }),
      message: (
        <div>
          <p>{t('With full access, the plugin runs with Node.js, as Insomnium itself does: it can read and change any of your files, run programs, and send anything anywhere, including the requests, tokens and responses it sees.')}</p>
          <p>{t('Allow it only if you trust the plugin and whoever publishes it.')}</p>
        </div>
      ),
      yesText: t('Allow Full Access'),
      noText: t('Cancel'),
      onDone: async yes => {
        if (yes) {
          await apply();
        }
      },
    });
  };

  return (
    <div>
      <p className="notice info no-margin-top">
        {t("Plugins run in a sandbox: without Node.js, so they can't read your files or run programs, and without the network, so what they see stays here.")} {t("A plugin that needs more can be allowed full access, which is the app's own.")}{' '}
        {tx('See the {link}.', { link: <Link href={docsPlugins}>{t('documentation')}</Link> })}
      </p>
      {plugins.length === 0 ? (
        <div className="text-center faint italic pad">{t('No Plugins Added')}</div>
      ) : (
        <table className="table--fancy table--striped table--valign-middle margin-top margin-bottom">
          <thead>
            <tr>
              <th>{t('Enable?')}</th>
              <th>{t('Name')}</th>
              <th>{t('Version')}</th>
              <th>{t('Access')}</th>
              <th>{t('Folder')}</th>
            </tr>
          </thead>
          <tbody>
            {plugins.map(plugin => {
              const link = `${NPM_PACKAGE_BASE}/${plugin.name}`;
              return !plugin.directory ? null : (
                <tr key={plugin.name}>
                  <td style={{ width: '4rem' }}>
                    <input
                      type="checkbox"
                      aria-label={plugin.name}
                      checked={!plugin.config.disabled}
                      disabled={isRefreshingPlugins}
                      onChange={async event => {
                        const newConfig = { ...plugin.config, disabled: !event.target.checked };
                        setState(state => ({ ...state, isRefreshingPlugins: true }));
                        patchSettings({ pluginConfig: { ...settings.pluginConfig, [plugin.name]: newConfig } });
                        refreshPlugins();
                      }}
                    />
                  </td>
                  <td>
                    {plugin.name}
                    {plugin.description && (
                      <HelpTooltip info className="space-left">
                        {plugin.description}
                      </HelpTooltip>
                    )}
                    {plugin.loadError && (
                      <div className="txt-sm warning" data-testid="plugin-load-error">
                        {plugin.needsNode
                          ? t("It needs Node.js (its {module} module), which sandboxed plugins don't have. Allow it full access if you trust it.", { module: plugin.needsNode })
                          : t("It didn't load: {error}", { error: plugin.loadError })}
                      </div>
                    )}
                  </td>
                  <td>
                    {plugin.version}
                    <a className="space-left" href={link} title={link}>
                      <i className="fa fa-external-link-square" />
                    </a>
                  </td>
                  <td className="no-wrap">
                    <label className="flex items-center gap-1" title={!plugin.sandboxed ? t('Runs with Node.js, as the app does') : t('Runs in a sandbox, without Node.js or the network')}>
                      <input
                        type="checkbox"
                        checked={!plugin.sandboxed}
                        disabled={isRefreshingPlugins}
                        onChange={event => setFullAccess(plugin, event.currentTarget.checked)}
                      />
                      {!plugin.sandboxed ? t('Full access') : t('Sandboxed')}
                    </label>
                  </td>
                  <td
                    className="no-wrap"
                    style={{
                      width: '10rem',
                    }}
                  >
                    <CopyButton
                      size="small"
                      variant="contained"
                      title={plugin.directory}
                      content={plugin.directory}
                    >
                      {t('Copy Path')}
                    </CopyButton>{' '}
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => window.shell.showItemInFolder(plugin.directory)}
                    >
                      {t('Reveal Folder')}
                    </Button>
                  </td>
                </tr>
              );
            }
            )}
          </tbody>
        </table>
      )}

      {error && (
        <div className="notice error text-left margin-bottom">
          <button className="pull-right icon" aria-label={t('Dismiss')} onClick={() => setState(state => ({ ...state, error: null }))}>
            <i className="fa fa-times" />
          </button>
          <div className="selectable force-pre-wrap">
            <b>{installPluginErrMsg}</b>
            {'\n\n' + t('There may be an issue with the plugin itself.') + ' '}
            {tx('You can {link}, or install one from a file.', { link: <a href={PLUGIN_SEARCH_URL}>{t('find plugins on npm')}</a> })}
            <details>
              <summary>{t('Additional Information')}</summary>
              <pre className="pad-top-sm force-wrap selectable">
                <code>{error.stack || error.message}</code>
              </pre>
            </details>
          </div>
        </div>
      )}

      <form
        onSubmit={async event => {
          event.preventDefault();
          // no package named, nothing to install (Enter in the empty field)
          if (!npmPluginValue.trim()) {
            return;
          }
          setState(state => ({ ...state, isInstallingFromNpm: true }));
          const newState: Partial<State> = {
            isInstallingFromNpm: false,
            error: null,
            installPluginErrMsg: '',
          };
          try {
            await window.main.installPlugin(npmPluginValue.trim());
            await refreshPlugins();
            newState.npmPluginValue = ''; // Clear input if successful install
          } catch (err) {
            newState.installPluginErrMsg = t('Failed to install {name}', { name: npmPluginValue });
            newState.error = err;
          }
          setState(state => ({ ...state, ...newState }));
        }}
      >
        <div className="form-row">
          <div className="form-control form-control--outlined">
            <input
              onChange={event => {
                if (event.target instanceof HTMLInputElement) {
                  setState(state => ({ ...state, npmPluginValue: event.target.value }));
                }
              }}
              disabled={isInstallingFromNpm}
              type="text"
              aria-label="npm package"
              placeholder="npm-package-name"
              value={npmPluginValue}
            />
          </div>
          <div className="form-control width-auto">
            <Button variant="contained" bg="surprise" disabled={isInstallingFromNpm || !npmPluginValue.trim()}>
              {isInstallingFromNpm && <i className="fa fa-refresh fa-spin space-right" />}
              {t('Install Plugin')}
            </Button>
          </div>
          <div className="form-control width-auto">
            <Button
              type="button"
              variant="contained"
              disabled={isInstallingFromNpm}
              onClick={async () => {
                const { canceled, filePath } = await selectFileOrFolder({ itemTypes: ['file'], extensions: ['tgz', 'gz'] });
                if (canceled || !filePath) {
                  return;
                }
                setState(state => ({ ...state, isInstallingFromNpm: true, error: null, installPluginErrMsg: '' }));
                try {
                  await window.main.installPluginFromFile(filePath);
                  await refreshPlugins();
                  setState(state => ({ ...state, isInstallingFromNpm: false }));
                } catch (err) {
                  setState(state => ({ ...state, isInstallingFromNpm: false, error: err, installPluginErrMsg: t('Failed to install {name}', { name: path.basename(filePath) }) }));
                }
              }}
            >
              {t('Install from File…')}
            </Button>
          </div>
        </div>
      </form>
      <div className="form-row">
        <TextSetting
          label={t('Registry')}
          setting="pluginRegistry"
          placeholder="https://registry.npmjs.org"
          help={t("Where Install Plugin gets packages from: a mirror, or your company's own registry. Installs go through the proxy set in General, as requests do.")}
        />
      </div>
      <div className="form-row">
        <TextSetting
          label={t('Other plugin folders')}
          setting="pluginPath"
          placeholder={path.delimiter === ';' ? 'C:\\plugins;D:\\more-plugins' : '~/plugins:/opt/more-plugins'}
          help={t('Folders to load plugins from as well as the plugins folder, separated by {delimiter}. Reload Plugins after changing them.', { delimiter: path.delimiter })}
        />
      </div>
      <hr />
      <div className="text-right">
        <Button
          onClick={() => window.main.openInBrowser(PLUGIN_SEARCH_URL)}
        >
          {t('Find Plugins on npm')}
        </Button>
        <Button
          style={{
            marginLeft: '0.3em',
          }}
          onClick={() => showPrompt({
            title: t('New Plugin'),
            defaultValue: 'demo-example',
            placeholder: 'example-name',
            submitName: t('Generate'),
            label: t('Plugin Name'),
            selectText: true,
            validate: name =>
              name.match(/^[a-z][a-z-]*[a-z]$/) ? '' : t('Plugin name must be of format my-plugin-name'),
            onComplete: async name => {
              // Remove insomnia-plugin- prefix if they accidentally typed it
              name = name.replace(/^insomnia-plugin-/, '');
              try {
                await createPlugin(
                  `insomnia-plugin-${name}`,
                  '0.0.1',
                  [
                    '// For help writing plugins, visit the documentation to get started:',
                    `//   ${docsPlugins}`,
                    '',
                    '// TODO: Add plugin code here...',
                  ].join('\n'),
                );
              } catch (err) {
                console.error(err);
                showAlert({
                  title: t('Failed to Create Plugin'),
                  message: err.message,
                });
              }
              refreshPlugins();
            },
          })}
        >{t('Generate New Plugin')}</Button>
        <Button
          style={{
            marginLeft: '0.3em',
          }}
          onClick={() => window.shell.showItemInFolder(path.join(processEnv['INSOMNIA_DATA_PATH'] || window.app.getPath('userData'), 'plugins'))}
        >
          {t('Reveal Plugins Folder')}
        </Button>
        <Button
          disabled={isRefreshingPlugins}
          style={{
            marginLeft: '0.3em',
          }}
          onClick={() => refreshPlugins()}
        >
          {t('Reload Plugins')}
          {isRefreshingPlugins && <i className="fa fa-refresh fa-spin space-left" />}
        </Button>
      </div>
    </div>
  );
};
