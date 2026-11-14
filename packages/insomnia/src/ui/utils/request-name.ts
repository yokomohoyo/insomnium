import { t } from '../../common/i18n';

// what every list calls a request: a nameless one goes by its URL, as in the sidebar
export const requestDisplayName = (request: { name?: string; url?: string }): string =>
  request.name || request.url || t('Untitled request');
