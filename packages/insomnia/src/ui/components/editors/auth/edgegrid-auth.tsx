import React, { FC } from 'react';

import { AuthInputRow } from './components/auth-input-row';
import { AuthTableBody } from './components/auth-table-body';
import { AuthToggleRow } from './components/auth-toggle-row';

// Akamai EdgeGrid (network/edgegrid.ts): the API client's credentials, from
// its .edgerc; the request's URL has the client's host
export const EdgeGridAuth: FC = () => (
  <AuthTableBody>
    <AuthToggleRow label="Enabled" property="disabled" invert />
    <AuthInputRow label='Client Token' property='clientToken' />
    <AuthInputRow label='Client Secret' property='clientSecret' mask />
    <AuthInputRow label='Access Token' property='accessToken' />
    <AuthInputRow label='Headers to Sign' property='headersToSign' help='Header names, comma-separated, if the API asks for any to be signed' />
    <AuthInputRow label='Max Body' property='maxBody' help='How much of a POST body is signed, in bytes (131072 by default)' />
  </AuthTableBody>
);
