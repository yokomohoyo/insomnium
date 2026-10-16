import classnames from 'classnames';
import type { IpcRendererEvent } from 'electron';
import React, { FC, useEffect, useState } from 'react';
import { useInterval } from 'react-use';
import styled from 'styled-components';

import { getProductName } from '../../common/constants';
import imgSrcCore from '../../icons/256x256.png';
import { Link } from './base/link';

const INSOMNIA_NOTIFICATIONS_SEEN = 'insomnia::notifications::seen';

export interface ToastNotification {
  key: string;
  url: string;
  cta: string;
  message: string;
}

const StyledLogo = styled.div`
  margin: var(--padding-xs) var(--padding-sm) var(--padding-xs) var(--padding-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  img {
    max-width: 5rem;
  }
`;
const StyledContent = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 0 var(--padding-xs) 0 var(--padding-xs);
  max-width: 20rem;
`;
const StyledFooter = styled.footer`
  padding-top: var(--padding-sm);
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  width: 100%;
`;

type SeenNotifications = Record<string, boolean>;

// Shared by every window (same origin), so one window's dismissal covers all
const readSeen = (): SeenNotifications => {
  try {
    return JSON.parse(window.localStorage.getItem(INSOMNIA_NOTIFICATIONS_SEEN) || '{}') as SeenNotifications || {};
  } catch (e) {
    return {};
  }
};

export const Toast: FC<{ checkForNewReleases: boolean }> = ({ checkForNewReleases }) => {
  const [notification, setNotification] = useState<ToastNotification | null>(null);
  const [visible, setVisible] = useState(false);
  const handleNotification = (notification: ToastNotification | null | undefined) => {
    if (!notification) {
      return;
    }
    console.log(`[toast] Received notification ${notification.key}`);
    if (readSeen()[notification.key]) {
      console.log(`[toast] Not showing notification ${notification.key} because has already been seen`);
      return;
    }
    setNotification(notification);
    setVisible(false);
    // Fade the notification in
    setTimeout(() => {
      setVisible(true);
    }, 1000);
  };
  const checkForNotifications = async () => {
    // If there is a notification open, skip check
    if (notification || !checkForNewReleases) {
      return;
    }
    // null unless a newer release exists; main asks GitHub at most once a day
    handleNotification(await window.main.checkForNewRelease().catch(() => null));
  };
  // Seen once the user acts on it, not when it arrives, so a notice in a window
  // nobody looked at comes back
  const close = () => {
    if (!notification) {
      return;
    }
    window.localStorage.setItem(INSOMNIA_NOTIFICATIONS_SEEN, JSON.stringify({ ...readSeen(), [notification.key]: true }, null, 2));
    // Hide the currently showing notification
    setVisible(false);
    // Give time for toast to fade out, then remove it
    setTimeout(() => setNotification(null), 1000);
  };

  useEffect(() => {
    const unsubscribe = window.main.on('show-notification', (_: IpcRendererEvent, notification: ToastNotification) => handleNotification(notification));
    return () => unsubscribe();
  }, []);

  // another window dismissed it; registered once and reads the current notice
  // from state, so it can't miss an event between a render and a re-subscribe
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === INSOMNIA_NOTIFICATIONS_SEEN) {
        setNotification(current => current && readSeen()[current.key] ? null : current);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // right away when turned on (and at startup), then hourly to catch a release while open
  useEffect(() => {
    checkForNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkForNewReleases]);
  useInterval(checkForNotifications, 60 * 60 * 1000);

  const productName = getProductName();
  return notification ? (
    <div
      className={classnames('toast theme--dialog', {
        'toast--show': visible,
      })}
    >
      <StyledLogo>
        <img src={imgSrcCore} alt={productName} />
      </StyledLogo>
      <StyledContent>
        <p>{notification?.message || 'Unknown'}</p>
        <StyledFooter>
          <button
            className="btn btn--super-duper-compact btn--outlined"
            onClick={close}
          >
            Dismiss
          </button>
          &nbsp;&nbsp;
          <Link
            button
            className="btn btn--super-duper-compact btn--outlined no-wrap"
            onClick={close}
            href={notification.url}
          >
            {notification.cta}
          </Link>
        </StyledFooter>
      </StyledContent>
    </div>
  ) : null;
};
