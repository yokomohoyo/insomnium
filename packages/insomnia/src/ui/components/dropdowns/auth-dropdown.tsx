import React, { FC } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import {
  AUTH_NONE,
  AuthType,
  getAuthTypeName,
  HAWK_ALGORITHM_SHA256,
} from '../../../common/constants';
import { t } from '../../../common/i18n';
import {
  addAuthStrategy,
  RequestAuthentication,
  RequestAuthenticationStrategy,
} from '../../../models/request';
import { SIGNATURE_METHOD_HMAC_SHA1 } from '../../../network/o-auth-1/constants';
import { GRANT_TYPE_AUTHORIZATION_CODE } from '../../../network/o-auth-2/constants';
import { newPluginStrategy } from '../../../plugins/auth-providers';
import { useAuthProviders } from '../editors/auth/plugin-auth';
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
  'jwt',
  'edgegrid',
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
    case 'jwt':
      return { type, disabled: false, algorithm: 'HS256', secret: '', secretBase64: false, privateKey: '', payload: '{}', header: '', expiresIn: '300', addTo: 'header', prefix: 'Bearer', queryParamKey: 'token' };
    case 'edgegrid':
      return { type, disabled: false, clientToken: '', clientSecret: '', accessToken: '', headersToSign: '', maxBody: '131072' };
    case 'netrc':
    default:
      return { type };
  }
}
interface StrategyDropdownProps {
  authentication: RequestAuthentication | undefined | null;
  onChange: (authentication: RequestAuthenticationStrategy[]) => void;
  authTypes?: AuthType[];
  disabled?: boolean;
  // a request can opt out of its folder's auth
  allowNone?: boolean;
  // the auth plugins add (HTTP requests and folders only: it runs with the request hooks)
  withPlugins?: boolean;
}

// Adds a strategy to a list of them: a request's, or a folder's
export const AuthStrategyDropdown: FC<StrategyDropdownProps> = ({ authentication, onChange, authTypes = defaultTypes, disabled = false, allowNone = false, withPlugins = false }) => {
  const providers = useAuthProviders();
  return (
  <Dropdown
    aria-label={t('Authentication Dropdown')}
    isDisabled={disabled}
    triggerButton={
      <DropdownButton className="tall">
        + {t('Add Auth')}
        <i className="fa fa-caret-down space-left" />
      </DropdownButton>
    }
  >
    <DropdownSection aria-label={t('Auth types section')} title={t('Add an Auth Strategy')}>
      {authTypes.map(authType => (
        <DropdownItem key={authType} aria-label={getAuthTypeName(authType, true)}>
          <ItemContent
            icon='empty'
            label={getAuthTypeName(authType, true)}
            onClick={() => onChange(addAuthStrategy(authentication, newStrategy(authType)))}
          />
        </DropdownItem>
      ))}
    </DropdownSection>
    <DropdownSection aria-label={t('Plugin auth section')} title={t('From Plugins')} items={withPlugins ? providers.map(item => ({ ...item, id: `${item.plugin}/${item.provider.name}` })) : []}>
      {item => (
        <DropdownItem key={item.id} aria-label={item.provider.displayName}>
          <ItemContent
            icon='plug'
            label={item.provider.displayName}
            onClick={() => onChange(addAuthStrategy(authentication, newPluginStrategy(item.plugin, item.provider)))}
          />
        </DropdownItem>
      )}
    </DropdownSection>
    <DropdownSection aria-label={t('Folder auth section')} items={allowNone ? [{ id: 'none' }] : []}>
      {item => (
        <DropdownItem key={item.id} aria-label={t("No auth, not the folder's")}>
          <ItemContent
            icon='ban'
            label={t("No auth, not the folder's")}
            onClick={() => onChange([{ type: AUTH_NONE }])}
          />
        </DropdownItem>
      )}
    </DropdownSection>
  </Dropdown>
  );
};

interface Props {
  authTypes?: AuthType[];
  disabled?: boolean;
  withPlugins?: boolean;
}

export const AuthDropdown: FC<Props> = ({ authTypes = defaultTypes, disabled = false, withPlugins = false }) => {
  const { activeRequest } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const { requestId } = useParams() as { organizationId: string; projectId: string; workspaceId: string; requestId: string };
  const patchRequest = useRequestSetter();

  if (!activeRequest) {
    return null;
  }

  return (
    <AuthStrategyDropdown
      // `authentication` may be missing on requests that predate the field
      // migration; addAuthStrategy() starts a fresh list then
      authentication={(activeRequest as any).authentication}
      onChange={authentication => patchRequest(requestId, { authentication })}
      authTypes={authTypes}
      disabled={disabled}
      allowNone
      withPlugins={withPlugins}
    />
  );
};
