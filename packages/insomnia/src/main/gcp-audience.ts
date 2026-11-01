import { BrowserWindow, dialog } from 'electron';

import { t } from '../common/i18n';
import { setGcpAudienceApproval } from '../network/authentication';
import { rendersAreRestricted } from './restricted-renders';

// The main process's say on a Google ID token for another audience
// (network/authentication.ts): never for an MCP client, which may be acting on
// an imported collection; for a gRPC call from the window, the user's, once a
// session for each audience and host.
const approved = new Set<string>();

setGcpAudienceApproval(({ audience, origin }) => {
  if (rendersAreRestricted()) {
    return false;
  }
  const key = `${audience}\n${origin}`;
  if (approved.has(key)) {
    return true;
  }
  const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const options = {
    type: 'warning' as const,
    buttons: [t('Cancel'), t('Send')],
    defaultId: 0,
    cancelId: 0,
    message: t('Send a Google ID token for another service?'),
    detail: t('This request gets a Google ID token for {audience}, from your Google credentials, and sends it to {origin}, which could then use it as you. Send it only if you trust this request.', { audience, origin }),
  };
  const choice = window ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options);
  if (choice === 1) {
    approved.add(key);
  }
  return choice === 1;
});
