// What Check for Updates found (main/release-check.ts), for the menu's dialog and Preferences
import { getProductName } from './constants';
import { t } from './i18n';

export type UpdateCheckResult =
  | { status: 'newer'; current: string; version: string; url: string }
  | { status: 'current'; current: string }
  | { status: 'failed'; current: string; error: string };

// what a check found, in a sentence
export const describeUpdateCheck = (result: UpdateCheckResult) => result.status === 'newer'
  ? t('{product} {version} is available. You have {current}.', { product: getProductName(), version: result.version, current: result.current })
  : result.status === 'current'
    ? t('You have the latest version of {product} ({current}).', { product: getProductName(), current: result.current })
    : t("Couldn't check for updates: {error}", { error: result.error });
