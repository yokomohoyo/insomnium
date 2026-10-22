import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import { getAppVersion } from '../../common/constants';
import { setLanguage } from '../../common/i18n';
import * as models from '../../models';
import { checkForNewRelease, isNewerVersion } from '../release-check';

describe('isNewerVersion()', () => {
  it.each([
    ['0.3.5', '0.3.4', true],
    ['0.10.0', '0.9.9', true],
    ['1.0.0', '0.99.99', true],
    ['v0.3.5', '0.3.4', true],
    ['0.3.4', '0.3.4-rc.2', true],
    ['0.3.4-rc.3', '0.3.4-rc.2', true],
    ['0.3.4-rc.10', '0.3.4-rc.9', true],
    ['0.3.4', '0.3.4', false],
    ['0.3.4-rc.2', '0.3.4', false],
    ['0.3.4', '0.3.5-rc.1', false],
    ['0.3.3', '0.3.4', false],
    ['latest', '0.3.4', false],
    ['0.3.5-beta.1', '0.3.4', false],
  ])('%s newer than %s: %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });
});

describe('checkForNewRelease()', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const installers = [{ name: 'Insomnium.Core-99.0.0.dmg' }, { name: 'Insomnium.Core-99.0.0.exe' }, { name: 'Insomnium.Core-99.0.0.AppImage' }];
  const release = (tag: string, { url = `https://github.com/yokomohoyo/insomnium/releases/tag/${tag}`, assets = installers } = {}) =>
    jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: url, assets }) }) as unknown as Response);
  const failing = () => jest.fn(async () => ({ ok: false, status: 503 }) as unknown as Response);
  const optIn = async (checkForNewReleases = true) =>
    models.settings.update(await models.settings.getOrCreate(), { checkForNewReleases });
  const notice = {
    key: 'release-99.0.0',
    url: 'https://github.com/yokomohoyo/insomnium/releases/tag/99.0.0',
    cta: 'View release',
    message: `Insomnium 99.0.0 is available. You have ${getAppVersion()}.`,
  };

  beforeEach(globalBeforeEach);

  it('does nothing unless the user opted in', async () => {
    const fetch = release('99.0.0');
    expect(await checkForNewRelease(fetch, 0)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends one plain GET to the GitHub releases API and notifies about a newer release', async () => {
    await optIn();
    const fetch = release('99.0.0');
    expect(await checkForNewRelease(fetch, 0)).toEqual(notice);
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/yokomohoyo/insomnium/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
    });
  });

  it("says it in the app's language", async () => {
    await optIn();
    setLanguage('de');
    try {
      expect(await checkForNewRelease(release('99.0.0'), 0)).toMatchObject({
        cta: 'Release ansehen',
        message: `Insomnium 99.0.0 ist verfügbar. Sie haben ${getAppVersion()}.`,
      });
    } finally {
      setLanguage('en');
    }
  });

  it('stays quiet when already on the latest release', async () => {
    await optIn();
    expect(await checkForNewRelease(release(getAppVersion()), 0)).toBeNull();
  });

  it('asks at most once a day, across restarts, and keeps returning the answer', async () => {
    await optIn();
    const fetch = release('99.0.0');
    await checkForNewRelease(fetch, 0);
    // the throttle is stored, not in memory: a new process sees it too
    expect((await models.stats.get()).releaseCheck?.nextCheckAt).toBe(DAY);
    expect(await checkForNewRelease(fetch, DAY - 1)).toEqual(notice);
    expect(fetch).toHaveBeenCalledTimes(1);
    await checkForNewRelease(fetch, DAY);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('backs off for 6 hours after a failed check', async () => {
    await optIn();
    expect(await checkForNewRelease(failing(), 0)).toBeNull();
    const fetch = release('99.0.0');
    expect(await checkForNewRelease(fetch, 6 * HOUR - 1)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await checkForNewRelease(fetch, 6 * HOUR)).toEqual(notice);
  });

  it('waits for the installers of a just-published release', async () => {
    await optIn();
    expect(await checkForNewRelease(release('99.0.0', { assets: [] }), 0)).toBeNull();
    expect(await checkForNewRelease(release('99.0.0'), HOUR)).toEqual(notice);
  });

  it('shares one request between callers that arrive together', async () => {
    await optIn();
    const fetch = release('99.0.0');
    expect(await Promise.all([checkForNewRelease(fetch, 0), checkForNewRelease(fetch, 0)])).toEqual([notice, notice]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops notifying once the user opts out', async () => {
    await optIn();
    await checkForNewRelease(release('99.0.0'), 0);
    await optIn(false);
    expect(await checkForNewRelease(release('99.0.0'), 1)).toBeNull();
  });

  it.each([
    'https://evil.example/download',
    'https://github.com.evil.example/x',
    'http://github.com/yokomohoyo/insomnium/releases/tag/99.0.0',
    'https://evil.example/https://github.com/',
  ])('ignores a release link that is not on https://github.com/ (%s)', async url => {
    await optIn();
    expect(await checkForNewRelease(release('99.0.0', { url }), 0)).toBeNull();
  });
});
