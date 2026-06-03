import React, { FC } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import { RequestLoaderData } from '../../../routes/request';
import { AuthInputRow } from './components/auth-input-row';
import { AuthSelectRow } from './components/auth-select-row';
import { AuthTableBody } from './components/auth-table-body';
import { AuthToggleRow } from './components/auth-toggle-row';

const SOURCE_OPTIONS = [
  { name: 'Application Default Credentials (ADC)', value: 'adc' },
  { name: 'Service account JSON: file path', value: 'sa-file' },
  { name: 'Service account JSON: paste inline', value: 'sa-inline' },
];

export const GcpIdTokenAuth: FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  const { activeRequest } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const source: string = activeRequest.authentication.credentialSource ?? 'adc';

  return (
    <AuthTableBody>
      <AuthToggleRow label="Enabled" property="disabled" invert disabled={disabled} />

      <AuthSelectRow
        label="Source"
        property="credentialSource"
        options={SOURCE_OPTIONS}
        disabled={disabled}
        help={
          <>
            <strong>ADC</strong> looks at <code>$GOOGLE_APPLICATION_CREDENTIALS</code> then{' '}
            <code>~/.config/gcloud/application_default_credentials.json</code>. Only{' '}
            <code>service_account</code>-shaped credentials are supported.
          </>
        }
      />

      {source === 'sa-file' && (
        <AuthInputRow
          label="SA file path"
          property="saFilePath"
          disabled={disabled}
          help="Absolute path to a service-account JSON key created via the GCP console or `gcloud iam service-accounts keys create`."
        />
      )}

      {source === 'sa-inline' && (
        <AuthInputRow
          label="SA JSON"
          property="saInlineJson"
          mask
          disabled={disabled}
          help="Pasted SA JSON is stored on the request and will be included if you export this workspace. Prefer the file path for shared workspaces."
        />
      )}

      <AuthInputRow
        label="Audience"
        property="audience"
        disabled={disabled}
        help="Leave blank to use the request URL's origin (scheme + host) — the conventional Cloud Run audience. Override when the receiving service requires a different `aud` claim."
      />
    </AuthTableBody>
  );
};
