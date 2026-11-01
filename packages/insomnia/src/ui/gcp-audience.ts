import { t } from '../common/i18n';
import { setGcpAudienceApproval } from '../network/authentication';

// The window's say on a Google ID token for another audience
// (network/authentication.ts): the user's, remembered on this computer for
// each audience and host.
const KEY = 'insomnium.approvedGcpAudiences';

const approved = (): string[] => {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

setGcpAudienceApproval(({ audience, origin }) => {
  const key = `${audience}\n${origin}`;
  if (approved().includes(key)) {
    return true;
  }
  const yes = window.confirm(t('This request gets a Google ID token for {audience}, from your Google credentials, and sends it to {origin}, which could then use it as you.\n\nSend it only if you trust this request.', { audience, origin }));
  if (yes) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify([...approved(), key].slice(-500)));
    } catch {
      // not kept: it'll be asked about again
    }
  }
  return yes;
});
