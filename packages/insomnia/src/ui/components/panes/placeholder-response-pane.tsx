import React, { FC, PropsWithChildren } from 'react';
import { useRouteLoaderData } from 'react-router-dom';
import styled from 'styled-components';

import { t } from '../../../common/i18n';
import { KeyboardShortcut } from '../../../common/settings';
import { RootLoaderData } from '../../routes/root';
import { Hotkey } from '../hotkey';
import { Pane, PaneBody, PaneHeader } from './pane';

const Wrapper = styled.div({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  whiteSpace: 'nowrap',
});

const Item = styled.div({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  margin: 'var(--padding-sm)',
});

const Description = styled.div({
  marginRight: '2em',
});

export const PlaceholderResponsePane: FC<PropsWithChildren<{}>> = ({ children }) => {
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;
  const { hotKeyRegistry } = settings;
  return (
    <Pane type="response">
      <PaneHeader />
      <PaneBody placeholder>
        <Wrapper>
          {[
            ['request_send', t('Send Request')],
            ['request_focusUrl', t('Focus URL')],
            ['showCookiesEditor', t('Edit Cookies')],
            ['environment_showEditor', t('Show Environment Editor')],
            ['preferences_showKeyboardShortcuts', t('Show Keyboard Shortcuts')],
          ].map(([shortcut, description]) => (
            <Item key={shortcut}>
              <Description>{description}</Description>
              <code>
                <Hotkey
                  keyBindings={hotKeyRegistry[shortcut as KeyboardShortcut]}
                  useFallbackMessage
                />
              </code>

            </Item>
          ))}
        </Wrapper>
      </PaneBody>
      {children}
    </Pane>
  );
};
