import React, { FC, useCallback } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import {
  AuthType,
  getAuthTypeName,
  HAWK_ALGORITHM_SHA256,
} from '../../../common/constants';
import {
  addAuthStrategy,
  RequestAuthenticationStrategy,
} from '../../../models/request';
import { SIGNATURE_METHOD_HMAC_SHA1 } from '../../../network/o-auth-1/constants';
import { GRANT_TYPE_AUTHORIZATION_CODE } from '../../../network/o-auth-2/constants';
import { useRequestSetter } from '../../hooks/use-request';
import { RequestLoaderData } from '../../routes/request';
import { Dropdown, DropdownButton, DropdownItem, DropdownSection, ItemContent } from '../base/dropdown';

const defaultTypes: AuthType[] = [
  'apikey',
  'basic',
  'digest',
  'oauth1',
  'oauth2',
  'ntlm',
  'iam',
  'bearer',
  'hawk',
  'asap',
  'gcp-id-token',
  'netrc',
];

// Factory for a fresh strategy of the given type. Multi-auth: each call appends
// a new entry to the request's authentication list; never replaces.
function newStrategy(type: string): RequestAuthenticationStrategy {
  switch (type) {
    case 'apikey':
      return { type, disabled: false, key: '', value: '', addTo: 'header' };
    case 'basic':
      return { type, useISO88591: false, disabled: false, username: '', password: '' };
    case 'digest':
    case 'ntlm':
      return { type, disabled: false, username: '', password: '' };
    case 'oauth1':
      return {
        type, disabled: false, signatureMethod: SIGNATURE_METHOD_HMAC_SHA1,
        consumerKey: '', consumerSecret: '', tokenKey: '', tokenSecret: '',
        privateKey: '', version: '1.0', nonce: '', timestamp: '', callback: '',
      };
    case 'oauth2':
      return { type, grantType: GRANT_TYPE_AUTHORIZATION_CODE };
    case 'iam':
      return { type, disabled: false, accessKeyId: '', secretAccessKey: '', sessionToken: '' };
    case 'hawk':
      return { type, algorithm: HAWK_ALGORITHM_SHA256 };
    case 'asap':
      return { type, issuer: '', subject: '', audience: '', additionalClaims: '', keyId: '', privateKey: '' };
    case 'gcp-id-token':
      return { type, disabled: false, credentialSource: 'adc', saFilePath: '', saInlineJson: '', audience: '' };
    case 'netrc':
    default:
      return { type };
  }
}

interface Props {
  authTypes?: AuthType[];
  disabled?: boolean;
}

export const AuthDropdown: FC<Props> = ({ authTypes = defaultTypes, disabled = false }) => {
  const { activeRequest } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const { requestId } = useParams() as { organizationId: string; projectId: string; workspaceId: string; requestId: string };
  const patchRequest = useRequestSetter();

  const addStrategy = useCallback((type: AuthType) => {
    if (!activeRequest) {
      return;
    }
    // `authentication` may be missing on requests that predate the field migration;
    // addAuthStrategy() handles null/undefined/empty by returning a fresh array.
    const current = (activeRequest as any).authentication;
    const next = addAuthStrategy(current, newStrategy(type));
    patchRequest(requestId, { authentication: next });
  }, [activeRequest, patchRequest, requestId]);

  if (!activeRequest) {
    return null;
  }

  return (
    <Dropdown
      aria-label='Authentication Dropdown'
      isDisabled={disabled}
      triggerButton={
        <DropdownButton className="tall">
          + Add Auth
          <i className="fa fa-caret-down space-left" />
        </DropdownButton>
      }
    >
      <DropdownSection aria-label='Auth types section' title="Add an Auth Strategy">
        {authTypes.map(authType => (
          <DropdownItem key={authType} aria-label={getAuthTypeName(authType, true)}>
            <ItemContent
              icon='empty'
              label={getAuthTypeName(authType, true)}
              onClick={() => addStrategy(authType)}
            />
          </DropdownItem>
        ))}
      </DropdownSection>
    </Dropdown>
  );
};
