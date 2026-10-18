import React, { FC, ReactNode, useCallback, useRef } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import {
  AUTH_API_KEY,
  AUTH_ASAP,
  AUTH_AWS_IAM,
  AUTH_BASIC,
  AUTH_BEARER,
  AUTH_DIGEST,
  AUTH_EDGEGRID,
  AUTH_GCP_ID_TOKEN,
  AUTH_HAWK,
  AUTH_JWT,
  AUTH_NETRC,
  AUTH_NONE,
  AUTH_NTLM,
  AUTH_OAUTH_1,
  AUTH_OAUTH_2,
  getAuthTypeName,
} from '../../../../common/constants';
import {
  getAuthStrategies,
  isRequest,
  patchAuthStrategy,
  removeAuthStrategy,
  RequestAuthentication,
  RequestAuthenticationStrategy,
} from '../../../../models/request';
import type { RequestGroup } from '../../../../models/request-group';
import { useFolderInheritance } from '../../../hooks/use-folder-inheritance';
import { useRequestSetter } from '../../../hooks/use-request';
import { RequestLoaderData } from '../../../routes/request';
import { ApiKeyAuth } from './api-key-auth';
import { AsapAuth } from './asap-auth';
import { EdgeGridAuth } from './edgegrid-auth';
import { JwtAuth } from './jwt-auth';
import { AuthStrategyProvider } from './auth-strategy-context';
import { AWSAuth } from './aws-auth';
import { BasicAuth } from './basic-auth';
import { BearerAuth } from './bearer-auth';
import { DigestAuth } from './digest-auth';
import { GcpIdTokenAuth } from './gcp-id-token-auth';
import { HawkAuth } from './hawk-auth';
import { NetrcAuth } from './netrc-auth';
import { NTLMAuth } from './ntlm-auth';
import { OAuth1Auth } from './o-auth-1-auth';
import { OAuth2Auth } from './o-auth-2-auth';

function renderEditor(type: string, disabled: boolean): ReactNode {
  switch (type) {
    case AUTH_BASIC: return <BasicAuth disabled={disabled} />;
    case AUTH_API_KEY: return <ApiKeyAuth disabled={disabled} />;
    case AUTH_OAUTH_2: return <OAuth2Auth />;
    case AUTH_HAWK: return <HawkAuth />;
    case AUTH_OAUTH_1: return <OAuth1Auth />;
    case AUTH_DIGEST: return <DigestAuth disabled={disabled} />;
    case AUTH_NTLM: return <NTLMAuth />;
    case AUTH_BEARER: return <BearerAuth disabled={disabled} />;
    case AUTH_AWS_IAM: return <AWSAuth />;
    case AUTH_NETRC: return <NetrcAuth />;
    case AUTH_ASAP: return <AsapAuth />;
    case AUTH_GCP_ID_TOKEN: return <GcpIdTokenAuth disabled={disabled} />;
    case AUTH_JWT: return <JwtAuth />;
    case AUTH_EDGEGRID: return <EdgeGridAuth />;
    case AUTH_NONE:
      return <div className="pad super-faint text-sm">Sends no auth, and doesn't use its folder's.</div>;
    default:
      return (
        <div className="pad super-faint text-sm">
          <em>Unsupported auth type: {type}</em>
        </div>
      );
  }
}

const EmptyState: FC<{ inheritedFrom?: RequestGroup }> = ({ inheritedFrom }) => (
  <div className="vertically-center text-center">
    <p className="pad super-faint text-sm text-center">
      <i className="fa fa-unlock-alt" style={{ fontSize: '8rem', opacity: 0.3 }} />
      <br /><br />
      {inheritedFrom ? (
        <>
          Uses the auth of the folder <strong>{inheritedFrom.name}</strong>
          {' '}({getAuthStrategies(inheritedFrom.authentication).map(({ type }) => getAuthTypeName(type as any, true) || type).join(', ')}).
          <br />
          Add a strategy to use this request&apos;s own instead.
        </>
      ) : 'No auth strategies. Use the Auth dropdown above to add one.'}
    </p>
  </div>
);

interface StrategiesEditorProps {
  authentication: RequestAuthentication | undefined | null;
  onChange: (authentication: RequestAuthenticationStrategy[]) => void;
  disabled?: boolean;
  // the types that can be edited here; others are shown, not opened
  editableTypes?: string[];
  // the folder whose auth applies while there's none here
  inheritedFrom?: RequestGroup;
}

// The editors for a list of strategies: a request's, or a folder's
export const AuthStrategiesEditor: FC<StrategiesEditorProps> = ({ authentication: given, onChange: save, disabled = false, editableTypes, inheritedFrom }) => {
  // Edits build on the latest list, not the props of the last render: the
  // inputs save after a pause, so a quick edit to a second field would
  // otherwise write the list back without the first. New props, from a save
  // that landed or from elsewhere, replace it.
  const latest = useRef(given);
  const seen = useRef(given);
  if (seen.current !== given) {
    seen.current = given;
    latest.current = given;
  }
  const authentication = latest.current;
  const onChange = (next: RequestAuthenticationStrategy[]) => {
    latest.current = next;
    save(next);
  };
  const strategies = getAuthStrategies(authentication);

  if (strategies.length === 0) {
    return <EmptyState inheritedFrom={inheritedFrom} />;
  }

  return (
    <div>
      {strategies.map((strategy, index) => (
        <AuthStrategyProvider
          key={`${strategy.type || 'none'}-${index}`}
          strategy={strategy}
          strategyIndex={index}
          patch={p => onChange(patchAuthStrategy(latest.current, index, p))}
        >
          <div className="border-bottom pad-bottom">
            <div className="flex flex--center pad-top pad-left pad-right">
              <strong className="txt-sm">
                {strategy.type === AUTH_NONE ? 'No auth' : getAuthTypeName(strategy.type as any, true) || 'Auth'}
              </strong>
              {strategy.type === AUTH_NONE ? <span className="flex-1" /> : (
                <input
                  className="margin-left form-control form-control--small flex-1"
                  placeholder="Header name override (defaults to Authorization)"
                  value={strategy.headerName || ''}
                  onChange={e => onChange(patchAuthStrategy(latest.current, index, { headerName: e.target.value || undefined }))}
                  disabled={disabled}
                  title="Override the destination header for this strategy (e.g., X-Goog-IAP-JWT-Assertion)"
                />
              )}
              <button
                className="btn btn--super-duper-compact btn--clicky margin-left-xs"
                onClick={() => onChange(removeAuthStrategy(latest.current, index))}
                disabled={disabled}
                title="Remove this auth strategy"
              >
                <i className="fa fa-trash-o" />
              </button>
            </div>
            {!editableTypes || editableTypes.includes(strategy.type as string)
              ? renderEditor(strategy.type as string, disabled)
              : <div className="pad super-faint text-sm">{getAuthTypeName(strategy.type as any, true) || strategy.type} can't be edited here yet; the requests still use it.</div>}
          </div>
        </AuthStrategyProvider>
      ))}
    </div>
  );
};

export const AuthWrapper: FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  const { activeRequest } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const { requestId } = useParams() as { requestId: string };
  const patchRequest = useRequestSetter();
  const { authFolder } = useFolderInheritance(activeRequest);

  const onChange = useCallback(
    (authentication: RequestAuthenticationStrategy[]) => patchRequest(requestId, { authentication }),
    [patchRequest, requestId],
  );

  return (
    <AuthStrategiesEditor
      authentication={activeRequest.authentication}
      onChange={onChange}
      disabled={disabled}
      // only HTTP requests are sent with their folder's auth
      inheritedFrom={isRequest(activeRequest) ? authFolder : undefined}
    />
  );
};
