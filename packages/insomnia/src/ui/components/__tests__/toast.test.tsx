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

  beforeEach(() => {
    window.localStorage.clear();
    checkForNewRelease.mockReset();
    checkForNewRelease.mockResolvedValue(notice);
    window.main = { checkForNewRelease, on: jest.fn(() => () => {}), openInBrowser: jest.fn() } as unknown as Window['main'];
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
    expect(queryByText(notice.message)).toBeNull();
  });
});
