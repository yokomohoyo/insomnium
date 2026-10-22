import { session } from 'electron';

import appConfig from '../../config/config.json';
import { getAppVersion, getProductName } from '../common/constants';
import { t } from '../common/i18n';
import * as models from '../models';
import type { ToastNotification } from '../ui/components/toast';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LATEST_RELEASE_URL = `https://api.github.com/repos/${appConfig.githubOrg}/${appConfig.githubRepo}/releases/latest`;

// X.Y.Z or X.Y.Z-rc.N, the only tags this project publishes; a release sorts after its rcs
const parseVersion = (tag: string) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(tag.trim());
  return match && [+match[1], +match[2], +match[3], match[4] === undefined ? Infinity : +match[4]];
};

export const isNewerVersion = (candidate: string, current: string) => {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) {
    return false;
  }
  const i = a.findIndex((part, index) => part !== b[index]);
  return i !== -1 && a[i] > b[i];
};

// A release is published before its installers are uploaded; wait for this platform's
const installerPattern = () => ({ darwin: /\.dmg$/, win32: /\.exe$/ } as Record<string, RegExp>)[process.platform] || /\.(AppImage|deb|rpm|tar\.gz)$/;

// Its own in-memory session (no cookies, cache or Accept-Language from the app),
// a fixed User-Agent, and the same proxy rule as the app's other requests: the
// configured proxy, otherwise direct.
const fetchAnonymously: typeof fetch = async (url, init) => {
  const releaseSession = session.fromPartition('release-check');
  releaseSession.setUserAgent(getProductName(), 'en');
  const { proxyEnabled, httpsProxy, httpProxy, noProxy } = await models.settings.getOrCreate();
  const proxy = proxyEnabled ? httpsProxy || httpProxy : '';
  await releaseSession.setProxy(proxy ? { proxyRules: proxy, proxyBypassRules: noProxy } : { mode: 'direct' });
  return releaseSession.fetch(url as string, init);
};

const toNotification = (latest: { tag: string; url: string } | null): ToastNotification | null =>
  latest && isNewerVersion(latest.tag, getAppVersion()) ? {
    key: `release-${latest.tag}`,
    url: latest.url,
    // in the app's language when it's asked for (the main process follows the setting)
    cta: t('View release'),
    message: t('{product} {version} is available. You have {current}.', { product: getProductName(), version: latest.tag, current: getAppVersion() }),
  } : null;

async function askGitHub(fetchImpl: typeof fetch, now: number) {
  let latest: { tag: string; url: string } | null = null;
  let nextCheckAt = now + DAY_MS;
  try {
    const response = await fetchImpl(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const release = await response.json() as { tag_name?: string; html_url?: string; assets?: { name: string }[] };
    const { tag_name: tag, html_url: url } = release;
    if (tag && url?.startsWith('https://github.com/')) {
      if (isNewerVersion(tag, getAppVersion()) && !release.assets?.some(asset => installerPattern().test(asset.name))) {
        nextCheckAt = now + HOUR_MS; // not downloadable yet
      } else {
        latest = { tag, url };
      }
    }
  } catch (err) {
    console.warn('[release-check] Could not check for a new release', err);
    nextCheckAt = now + 6 * HOUR_MS;
  }
  await models.stats.update({ releaseCheck: { nextCheckAt, latest } });
  return toNotification(latest);
}

let pending: Promise<ToastNotification | null> | null = null;

// Opt-in, and at most once a day across restarts (6h after a failure): one GET
// to the GitHub releases API with no account, token or workspace data.
export async function checkForNewRelease(fetchImpl: typeof fetch = fetchAnonymously, now = Date.now()): Promise<ToastNotification | null> {
  const { checkForNewReleases } = await models.settings.getOrCreate();
  if (!checkForNewReleases) {
    return null;
  }
  const { releaseCheck } = await models.stats.get();
  if (releaseCheck && now < releaseCheck.nextCheckAt) {
    return toNotification(releaseCheck.latest);
  }
  pending ??= askGitHub(fetchImpl, now).finally(() => {
    pending = null;
  });
  return pending;
}
