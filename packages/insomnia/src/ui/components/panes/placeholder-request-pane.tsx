import React, { FC, useCallback } from 'react';
import { useRouteLoaderData } from 'react-router-dom';
import { useFetcher, useParams } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { RootLoaderData } from '../../routes/root';
import { Hotkey } from '../hotkey';
import { Pane, PaneBody, PaneHeader } from './pane';

export const PlaceholderRequestPane: FC = () => {
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;
  const { hotKeyRegistry } = settings;
  const requestFetcher = useFetcher();
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const createHttpRequest = useCallback(() =>
    requestFetcher.submit({ requestType: 'HTTP', parentId: workspaceId },
      {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug/request/new`,
        method: 'post',
        encType: 'application/json',
      }), [requestFetcher, organizationId, projectId, workspaceId]);

  return (
    <Pane type="request">
      <PaneHeader />
      <PaneBody placeholder>
        <div>
          <table className="table--fancy">
            <tbody>
              <tr>
                <td>{t('New Request')}</td>
                <td className="text-right">
                  <code>
                    <Hotkey
                      keyBindings={hotKeyRegistry.request_createHTTP}
                      useFallbackMessage
                    />
                  </code>
                </td>
              </tr>
              <tr>
                <td>{t('Switch Requests')}</td>
                <td className="text-right">
                  <code>
                    <Hotkey
                      keyBindings={hotKeyRegistry.request_quickSwitch}
                      useFallbackMessage
                    />
                  </code>
                </td>
              </tr>
              <tr>
                <td>{t('Edit Environments')}</td>
                <td className="text-right">
                  <code>
                    <Hotkey
                      keyBindings={hotKeyRegistry.environment_showEditor}
                      useFallbackMessage
                    />
                  </code>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="text-center pane__body--placeholder__cta">
            <button className="btn inline-block btn--clicky" onClick={createHttpRequest}>
              {t('New HTTP Request')}
            </button>
          </div>
        </div>
      </PaneBody>
    </Pane>
  );
};
