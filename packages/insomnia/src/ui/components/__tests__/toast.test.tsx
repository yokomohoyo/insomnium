import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import { Toast, ToastNotification } from '../toast';

const SEEN = 'insomnia::notifications::seen';
const notice: ToastNotification = {
  key: 'release-99.0.0',
  url: 'https://github.com/yokomohoyo/insomnium/releases/tag/99.0.0',
  cta: 'View release',
  message: 'Insomnium 99.0.0 is available. You have 0.3.4.',
};

describe('<Toast />', () => {
  const checkForNewRelease = jest.fn<() => Promise<ToastNotification | null>>();
  const credentialStorageNotices = jest.fn<() => Promise<ToastNotification[]>>();

  beforeEach(() => {
    window.localStorage.clear();
    checkForNewRelease.mockReset();
    checkForNewRelease.mockResolvedValue(notice);
    credentialStorageNotices.mockReset();
    credentialStorageNotices.mockResolvedValue([]);
    window.main = { checkForNewRelease, credentialStorageNotices, on: jest.fn(() => () => {}), openInBrowser: jest.fn() } as unknown as Window['main'];
  });

  const credentialNotice: ToastNotification = { key: 'credentials-unreadable-a1', url: 'https://example.com', cta: 'Learn more', message: 'Some saved credentials read as empty' };
  const weakNotice: ToastNotification = { key: 'credentials-weak', url: 'https://example.com', cta: 'Learn more', message: 'No system keyring was found' };

  it('shows a credential storage notice even when release checks are off', async () => {
    credentialStorageNotices.mockResolvedValue([credentialNotice]);
    const { findByText } = render(<Toast checkForNewReleases={false} />);
    await findByText(credentialNotice.message);
    expect(checkForNewRelease).not.toHaveBeenCalled();
  });

  it('shows the first credential notice not yet dismissed', async () => {
    credentialStorageNotices.mockResolvedValue([credentialNotice, weakNotice]);
    window.localStorage.setItem(SEEN, JSON.stringify({ [credentialNotice.key]: true }));
    const { findByText } = render(<Toast checkForNewReleases />);
    await findByText(weakNotice.message);
  });

  it('shows a release once the credential notices were dismissed', async () => {
    credentialStorageNotices.mockResolvedValue([credentialNotice]);
    window.localStorage.setItem(SEEN, JSON.stringify({ [credentialNotice.key]: true }));
    const { findByText } = render(<Toast checkForNewReleases />);
    await findByText(notice.message);
  });

  it('shows what was waiting behind a notice right after it is dismissed', async () => {
    credentialStorageNotices.mockResolvedValue([credentialNotice]);
    const { findByText } = render(<Toast checkForNewReleases />);
    await findByText(credentialNotice.message);
    expect(checkForNewRelease).not.toHaveBeenCalled();
    fireEvent.click(await findByText('Dismiss'));
    await findByText(notice.message, {}, { timeout: 3000 });
    // and nothing re-shows the dismissed one
    expect(credentialStorageNotices).toHaveBeenCalledTimes(2);
  });

  it('does not ask main unless the user opted in', async () => {
    render(<Toast checkForNewReleases={false} />);
    await act(async () => {});
    expect(checkForNewRelease).not.toHaveBeenCalled();
  });

  it('shows a newer release when opted in', async () => {
    const { findByText } = render(<Toast checkForNewReleases />);
    await findByText(notice.message);
    expect(checkForNewRelease).toHaveBeenCalledTimes(1);
  });

  it('asks as soon as the setting is turned on', async () => {
    const { rerender, findByText } = render(<Toast checkForNewReleases={false} />);
    rerender(<Toast checkForNewReleases />);
    await findByText(notice.message);
  });

  it('does not show a release the user already dismissed', async () => {
    window.localStorage.setItem(SEEN, JSON.stringify({ [notice.key]: true }));
    const { queryByText } = render(<Toast checkForNewReleases />);
    await waitFor(() => expect(checkForNewRelease).toHaveBeenCalled());
    await act(async () => {});
    expect(queryByText(notice.message)).toBeNull();
  });

  it('marks it seen when dismissed, not when it arrives', async () => {
    const { findByText } = render(<Toast checkForNewReleases />);
    await findByText(notice.message);
    expect(window.localStorage.getItem(SEEN)).toBeNull();
    fireEvent.click(await findByText('Dismiss'));
    expect(JSON.parse(window.localStorage.getItem(SEEN) || '{}')).toEqual({ [notice.key]: true });
  });

  it('closes when another window dismisses it', async () => {
    const { findByText, queryByText } = render(<Toast checkForNewReleases />);
    await findByText(notice.message);
    window.localStorage.setItem(SEEN, JSON.stringify({ [notice.key]: true }));
    fireEvent(window, Object.assign(new Event('storage'), { key: SEEN }));
    await waitFor(() => expect(queryByText(notice.message)).toBeNull());
  });
});
