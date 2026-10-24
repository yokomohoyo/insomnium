import React from 'react';

import { t } from '../../../../common/i18n';
import type { DeviceCodePrompt } from '../../../../network/o-auth-2/device-code';
import { hideAlert, showAlert } from '../../modals';

// The device code grant's dialog (network/o-auth-2/device-code.ts): the code
// to enter, and the page to enter it on. Closing it cancels the sign-in; it
// closes itself when the token comes.
export const showDeviceCodePrompt = ({ authorization, cancel }: DeviceCodePrompt) => {
  const page = authorization.verificationUriComplete || authorization.verificationUri;
  let open = true;
  showAlert({
    title: t('Sign In on Another Device'),
    message: (
      <div className="selectable">
        <p>{t('Enter this code at {page}:', { page: authorization.verificationUri })}</p>
        <p className="txt-xl monospace" data-testid="device-user-code">{authorization.userCode}</p>
        <p>
          <button type="button" className="btn btn--clicky" onClick={() => window.clipboard.writeText(authorization.userCode)}>
            {t('Copy Code')}
          </button>{' '}
          <button type="button" className="btn btn--clicky" onClick={() => window.main.openInBrowser(page)}>
            {t('Open the Page')}
          </button>
        </p>
        <p className="faint">{t('Waiting for the sign-in to finish…')}</p>
      </div>
    ),
    okLabel: t('Cancel'),
    onHide: () => {
      if (open) {
        open = false;
        cancel();
      }
    },
  });
  return () => {
    if (open) {
      open = false;
      hideAlert();
    }
  };
};
