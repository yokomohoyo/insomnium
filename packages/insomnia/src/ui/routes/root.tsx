import '../css/styles.css';

import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import type { IpcRendererEvent } from 'electron';
import React, { Fragment, useEffect, useState } from 'react';
import {
  Breadcrumbs,
  Button,
  Item,
  Link,
  Tooltip,
  TooltipTrigger,
} from 'react-aria-components';
import {
  LoaderFunction,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  useRouteLoaderData,
} from 'react-router-dom';

/**** ><> ↑ --------- Imports */

import { isDevelopment } from '../../common/constants';
import { t } from '../../common/i18n';
import { tx } from '../tx';
import * as models from '../../models';

import { Settings } from '../../models/settings';
import { isDesign } from '../../models/workspace';
import { assertValidThemeName } from '../../main/validate-package-spec';
import { reloadPlugins } from '../../plugins';
import { createPlugin } from '../../plugins/create';
import { setTheme } from '../../plugins/misc';
/**** ><> ↑ --------- Account and Models */

import { ConsoleDrawer } from '../components/console-drawer';
import { WorkspaceDropdown } from '../components/dropdowns/workspace-dropdown';
import { Hotkey } from '../components/hotkey';
import { Icon } from '../components/icon';

import { showError, showModal } from '../components/modals';
import { AlertModal } from '../components/modals/alert-modal';
import { AskModal } from '../components/modals/ask-modal';
import { ImportModal } from '../components/modals/import-modal';

import {
  /**** ><> ↑ --------- Modal Components */
  SettingsModal,
  showSettingsModal,
  TAB_INDEX_PLUGINS,
  TAB_INDEX_THEMES } from '../components/modals/settings-modal';
import { Toast } from '../components/toast';

import { AppHooks } from '../containers/app-hooks';

import { NunjucksEnabledProvider } from '../context/nunjucks/nunjucks-enabled-context';
/**** ><> ↑ --------- Settings and Themes */
import { useSettingsPatcher } from '../hooks/use-request';
import Modals from './modals';

import { WorkspaceLoaderData } from './workspace';
import { DEFAULT_ORGANIZATION_ID } from '../../models/organization';

/**** ><> ↑ --------- Hooks and Containers */

export interface RootLoaderData {
  settings: Settings;
}

export const loader: LoaderFunction = async (): Promise<RootLoaderData> => {
  return {
    settings: await models.settings.getOrCreate(),
  };
};
/**** ><> ↑ --------- Root Loader Data */

/**** ><> ↑ --------- Helper Function */

// the request switcher's own event, so the header's search box can open it
export const QUICK_SWITCH_EVENT = 'insomnium:quick-switch';

// a workspace's views, in the rail; each link's text stays the route's own word
const WORKSPACE_VIEWS: { path: string; icon: IconProp; label: () => string }[] = [
  { path: 'spec', icon: 'file-lines', label: () => t('spec') },
  { path: 'debug', icon: 'arrow-right-arrow-left', label: () => t('requests') },
  { path: 'test', icon: 'flask', label: () => t('test') },
  { path: 'flows', icon: 'diagram-project', label: () => t('flows') },
];

const RAIL_ITEM = 'flex flex-col items-center justify-center gap-[2px] w-[52px] py-[--padding-xs] rounded-md no-underline hover:no-underline text-[--hl] hover:text-[--color-font] hover:bg-[--hl-xs] outline-none focus-visible:ring-1 focus-visible:ring-[--hl-md] transition-colors';
const RAIL_BUTTON = 'flex items-center justify-center w-9 h-9 rounded-md text-[--hl] hover:text-[--color-font] hover:bg-[--hl-xs] aria-pressed:bg-[--hl-sm] aria-pressed:text-[--color-font] outline-none focus-visible:ring-1 focus-visible:ring-[--hl-md] transition-colors';
const TOOLTIP = 'border select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md focus:outline-none';

// a place in the rail: an icon over its name
const RailLink = ({ label, icon, to, active }: { label: string; icon: IconProp; to: string; active?: boolean }) => (
  <NavLink
    to={to}
    className={({ isActive }) => `${RAIL_ITEM} ${(active ?? isActive) ? 'bg-[--hl-sm] text-[--color-font]' : ''}`}
  >
    <span className="flex items-center justify-center w-7 h-7">
      <Icon icon={icon} />
    </span>
    <span className="text-[10px] leading-tight capitalize">{label}</span>
  </NavLink>
);

const Root = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useLoaderData() as RootLoaderData;

  const workspaceData = useRouteLoaderData(
    ':workspaceId'
  ) as WorkspaceLoaderData | null;
  const [importUri, setImportUri] = useState('');
  const [isConsoleOpen, setConsoleOpen] = useState(false);
  const patchSettings = useSettingsPatcher();

  useEffect(() => {
      navigate({
        pathname: location.pathname,
        hash: 'revalidate=true',
      });
  }, [location.pathname, navigate]);

  // (database changes revalidate the routes: revalidate-on-changes.ts)

  useEffect(() => {
    return window.main.on(
      'shell:open',
      async (_: IpcRendererEvent, url: string) => {
        // Get the url without params
        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch (err) {
          console.log('Invalid args, expected insomnia://x/y/z', url);
          return;
        }
        let urlWithoutParams = url.substring(0, url.indexOf('?')) || url;
        const params = Object.fromEntries(parsedUrl.searchParams);
        // Change protocol for dev redirects to match switch case
        if (isDevelopment()) {
          urlWithoutParams = urlWithoutParams.replace(
            'insomniadev://',
            'insomnia://'
          );
        }
        switch (urlWithoutParams) {
          case 'insomnia://app/alert':
            showModal(AlertModal, {
              title: params.title,
              message: params.message,
            });
            break;

          case 'insomnia://app/import':
            setImportUri(params.uri);
            break;

          case 'insomnia://plugins/install':
            showModal(AskModal, {
              title: t('Plugin Install'),
              message: (
                <>
                  {tx('Do you want to install {name}?', { name: <code>{params.name}</code> })} {t('It runs in a sandbox, without Node.js or the network, unless you allow it full access in Preferences → Plugins.')}
                </>
              ),
              yesText: t('Install'),
              noText: t('Cancel'),
              onDone: async (isYes: boolean) => {
                if (isYes) {
                  try {
                    await window.main.installPlugin(params.name);
                    showModal(SettingsModal, { tab: TAB_INDEX_PLUGINS });
                  } catch (err) {
                    showError({
                      title: t('Plugin Install'),
                      message: t('Failed to install plugin'),
                      error: err.message,
                    });
                  }
                }
              },
            });
            break;

          case 'insomnia://plugins/theme': {
            const parsedTheme = JSON.parse(decodeURIComponent(params.theme));
            // Reject before showing the modal - a malicious deep link should not
            // get to display a confirmation dialog that, if accepted, would write
            // outside the plugins directory.
            assertValidThemeName(parsedTheme.name);
            showModal(AskModal, {
              title: t('Install Theme'),
              message: (
                <>
                  {tx('Do you want to install {name}?', { name: <code>{parsedTheme.displayName}</code> })}
                </>
              ),
              yesText: t('Install'),
              noText: t('Cancel'),
              onDone: async (isYes: boolean) => {
                if (isYes) {
                  const mainJsContent = `module.exports.themes = [${JSON.stringify(
                    parsedTheme,
                    null,
                    2
                  )}];`;
                  await createPlugin(
                    `theme-${parsedTheme.name}`,
                    '0.0.1',
                    mainJsContent
                  );
                  patchSettings({ theme: parsedTheme.name });
                  await reloadPlugins();
                  await setTheme(parsedTheme.name, (await models.settings.getOrCreate()).autoDetectColorScheme);
                  showModal(SettingsModal, { tab: TAB_INDEX_THEMES });
                }
              },
            });
            break;
          }

          case 'insomnia://app/auth/finish': {

            break;
          }

          default: {
            console.log(`Unknown deep link: ${url}`);
          }
        }
      }
    );
  }, [patchSettings]);

  const { organizationId, projectId, workspaceId } = useParams() as {
    organizationId: string;
    projectId?: string;
    workspaceId?: string;
  };

  const crumbs = workspaceData
    ? [
        {
          id: workspaceData.activeProject._id,
          label: workspaceData.activeProject.name,
          node: (
            <Link data-testid="project">
              <NavLink
                to={`/organization/${organizationId}/project/${workspaceData.activeProject._id}`}
                title={t('All collections in {name}', { name: workspaceData.activeProject.name })}
                className="flex items-center gap-1.5 px-1.5 py-0.5 -mx-1.5 rounded-sm no-underline text-[--hl] hover:text-[--color-font] hover:bg-[--hl-xs] transition-colors"
              >
                <Icon icon="folder-open" className="text-xs" />
                {workspaceData.activeProject.name}
              </NavLink>
            </Link>
          ),
        },
        {
          id: workspaceData.activeWorkspace._id,
          label: workspaceData.activeWorkspace.name,
          node: <WorkspaceDropdown />,
        },
      ]
    : [];

  return (
      <NunjucksEnabledProvider>
        <AppHooks />
        <div className="app">
          <Modals />
          {/* triggered by insomnia://app/import */}
          {importUri && (
            <ImportModal
              onHide={() => setImportUri('')}
              projectName="Insomnium"
              organizationId={organizationId}
              from={{ type: 'uri', defaultValue: importUri }}
            />
          )}
          <div className="w-full h-full divide-x divide-solid divide-y divide-[--hl-md] grid-template-app-layout grid relative bg-[--color-bg]">
            {workspaceData && (
              <header className="[grid-area:Header] flex items-center gap-[--padding-md] h-[--line-height-xs] px-[--padding-md]">
                <Breadcrumbs items={crumbs}>
                  {item => (
                    <Item key={item.id} id={item.id}>
                      {item.node}
                    </Item>
                  )}
                </Breadcrumbs>
                <span className="flex-1" />
                {/\/debug(\/|$)/.test(location.pathname) && (
                  <Button
                    aria-label={t('Search requests')}
                    onPress={() => window.dispatchEvent(new Event(QUICK_SWITCH_EVENT))}
                    className="flex items-center gap-2 w-64 max-w-[30vw] px-[--padding-sm] py-[--padding-xxs] rounded-md border border-solid border-[--hl-md] text-[--hl] text-xs hover:border-[--hl] hover:bg-[--hl-xxs] focus:ring-1 focus:ring-[--hl-md] transition-colors"
                  >
                    <Icon icon="search" />
                    <span className="flex-1 text-left">{t('Search requests')}</span>
                    <Hotkey keyBindings={settings.hotKeyRegistry.request_quickSwitch} />
                  </Button>
                )}
                <span className="flex-1" />
              </header>
            )}
            <nav aria-label={t('App')} className="[grid-area:Navbar] flex flex-col items-center gap-[--padding-xs] w-full h-full overflow-y-auto py-[--padding-sm]">
              {/* the breadcrumb leads back from a collection; pages outside the
                  projects (import, updates) have only this */}
              {!location.pathname.includes('organization') && (
                <RailLink
                  label={t('Projects')}
                  icon="folder-open"
                  to={localStorage.getItem('requester_locationHistoryEntry') || `/organization/${DEFAULT_ORGANIZATION_ID}`}
                />
              )}
              {workspaceData?.activeWorkspace && (
                <Fragment>
                  {(isDesign(workspaceData.activeWorkspace) ? WORKSPACE_VIEWS : WORKSPACE_VIEWS.filter(view => view.path !== 'spec')).map(view => (
                    <RailLink
                      key={view.path}
                      label={view.label()}
                      icon={view.icon}
                      to={`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${view.path}`}
                    />
                  ))}
                </Fragment>
              )}
              <span className="flex-1" />
              <TooltipTrigger>
                <Button
                  data-testid="console-button"
                  aria-label={t('Console')}
                  aria-pressed={isConsoleOpen}
                  className={RAIL_BUTTON}
                  onPress={() => setConsoleOpen(!isConsoleOpen)}
                >
                  <Icon icon="terminal" />
                </Button>
                <Tooltip placement="right" offset={8} className={TOOLTIP}>{t('Console')}</Tooltip>
              </TooltipTrigger>
              <TooltipTrigger>
                <Button
                  data-testid="settings-button"
                  aria-label={t('Preferences')}
                  className={RAIL_BUTTON}
                  onPress={showSettingsModal}
                >
                  <Icon icon="gear" />
                </Button>
                <Tooltip placement="right" offset={8} className={`${TOOLTIP} flex items-center gap-2`}>
                  {t('Preferences')}
                  <Hotkey keyBindings={settings.hotKeyRegistry.preferences_showGeneral} />
                </Tooltip>
              </TooltipTrigger>
            </nav>
            <Outlet />
            {isConsoleOpen && <ConsoleDrawer onClose={() => setConsoleOpen(false)} />}
          </div>

          <Toast checkForNewReleases={settings.checkForNewReleases} />
        </div>
    </NunjucksEnabledProvider>
  );
};

export default Root;
/**** ><> ↑ --------- Export */
