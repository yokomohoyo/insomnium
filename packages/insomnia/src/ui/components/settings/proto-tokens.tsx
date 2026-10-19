import React, { FC } from 'react';

import { t } from '../../../common/i18n';
import { MaskedSetting } from './masked-setting';

export const ProtoTokens: FC = () => (
  <div>
    <p className="faint italic margin-bottom-sm">
      {t('Used by the "Import from URL" button in the proto-files modal.')}{' '}
      {t('Leave blank for public-only sources.')}{' '}
      {t('Tokens are saved encrypted when a system keychain is available.')}
    </p>

    <MaskedSetting
      label={t('Buf Schema Registry token')}
      setting="bufToken"
      placeholder={t('paste a BSR user token')}
      help={t('Create at https://buf.build/settings/user → API tokens. Required only for private BSR modules.')}
    />

    <MaskedSetting
      label={t('GitHub personal access token')}
      setting="githubToken"
      placeholder={t('ghp_… or github_pat_…')}
      help={t('Required for private GitHub repos and to raise the unauthenticated rate limit (60/hr → 5000/hr). Scopes: `repo` (or fine-grained Contents:read).')}
    />
  </div>
);
