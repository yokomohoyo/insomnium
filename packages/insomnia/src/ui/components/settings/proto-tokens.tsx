import React, { FC } from 'react';

import { MaskedSetting } from './masked-setting';

export const ProtoTokens: FC = () => (
  <div>
    <p className="faint italic margin-bottom-sm">
      Used by the "Import from URL" button in the proto-files modal. Leave blank
      for public-only sources. Tokens are stored in the local settings file.
    </p>

    <MaskedSetting
      label="Buf Schema Registry token"
      setting="bufToken"
      placeholder="paste a BSR user token"
      help="Create at https://buf.build/settings/user → API tokens. Required only for private BSR modules."
    />

    <MaskedSetting
      label="GitHub personal access token"
      setting="githubToken"
      placeholder="ghp_… or github_pat_…"
      help={
        'Required for private GitHub repos and to raise the unauthenticated ' +
        'rate limit (60/hr → 5000/hr). Scopes: `repo` (or fine-grained Contents:read).'
      }
    />
  </div>
);
