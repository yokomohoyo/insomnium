import { BrowserWindow, safeStorage } from 'electron';

import type { GuardState, KeyWrapper } from '../common/credential-guard';
import { credentialStorageStatus } from '../common/database';
import { t } from '../common/i18n';
import type { ToastNotification } from '../ui/components/toast';

// Wraps the credential data key with the OS keychain: Keychain on macOS, DPAPI
// on Windows, Secret Service / KWallet on Linux. The async API is the one that
// survives Electron 46.
export const safeStorageKeyWrapper: KeyWrapper = {
  async wrap(key) {
    return (await safeStorage.encryptStringAsync(key.toString('base64'))).toString('base64');
  },
  async unwrap(wrapped) {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(wrapped, 'base64'));
    return { key: Buffer.from(result, 'base64'), rewrap: shouldReEncrypt };
  },
  // On Linux without a reachable keyring safeStorage falls back to a built-in
  // key ('v10'), which only obfuscates
  isWeak(wrapped) {
    return process.platform === 'linux' && Buffer.from(wrapped, 'base64').subarray(0, 3).toString('latin1') === 'v10';
  },
};

const LEARN_MORE = 'https://github.com/yokomohoyo/insomnium#saved-credentials';
const launchedAt = Date.now();

// Notices for the Toast when credential storage needs the user's attention, most
// pressing first; the Toast shows the first one not yet dismissed.
export function credentialStorageNotices({ state, unreadableKeys }: { state: GuardState; unreadableKeys: string[] }): ToastNotification[] {
  const notice = (key: string, message: string) => ({ key, url: LEARN_MORE, cta: t('Learn more'), message });
  if (state === 'locked' || state === 'unavailable') {
    // every launch until it works
    return [notice(`credentials-${state}-${launchedAt}`, state === 'locked'
      ? t('The system keychain could not unlock your saved credentials, so they read as empty. Credentials you enter now are kept only until you quit.')
      : t('The system keychain is unavailable, so credentials you enter are kept only until you quit, and not saved to disk.'))];
  }
  const notices: ToastNotification[] = [];
  if (unreadableKeys.length) {
    notices.push(notice(`credentials-unreadable-${unreadableKeys.join('-')}`,
      t('Some saved credentials were encrypted on another computer or under an earlier system keychain, so they read as empty here. Enter them again to save them.')));
  }
  if (state === 'weak') {
    notices.push(notice('credentials-weak', process.env.SNAP
      ? t("Saved credentials (git tokens, OAuth tokens, certificate passphrases) are only obfuscated on disk, because this snap can't reach your keyring. Run: {command}", { command: 'sudo snap connect insomnium:password-manager-service' })
      : t('No system keyring was reachable, so saved credentials (git tokens, OAuth tokens, certificate passphrases) are only obfuscated on disk. Run and unlock a keyring such as GNOME Keyring or KWallet to encrypt them.')));
  }
  return notices;
}

// A save just changed how credentials are stored (the keychain refused the first
// key, say): tell the open windows now rather than at the next check.
export function announceCredentialStorage() {
  const [notice] = credentialStorageNotices(credentialStorageStatus());
  if (notice) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('show-notification', notice);
    }
  }
}
