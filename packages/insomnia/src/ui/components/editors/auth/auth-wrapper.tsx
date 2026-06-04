import React, { FC, ReactNode, useCallback } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import {
  AUTH_API_KEY,
  AUTH_ASAP,
  AUTH_AWS_IAM,
  AUTH_BASIC,
  AUTH_BEARER,
  AUTH_DIGEST,
  AUTH_GCP_ID_TOKEN,
  AUTH_HAWK,
  AUTH_NETRC,
  AUTH_NTLM,
  AUTH_OAUTH_1,
  AUTH_OAUTH_2,
  getAuthTypeName,
} from '../../../../common/constants';
import {
  getAuthStrategies,
  patchAuthStrategy,
  removeAuthStrategy,
  RequestAuthenticationStrategy,
} from '../../../../models/request';
import { useRequestSetter } from '../../../hooks/use-request';
import { RequestLoaderData } from '../../../routes/request';
import { ApiKeyAuth } from './api-key-auth';
import { AsapAuth } from './asap-auth';
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
    default:
      return (
        <div className="pad super-faint text-sm">
          <em>Unsupported auth type: {type}</em>
        </div>
      );
  }
}

const EmptyState: FC = () => (
  <div className="vertically-center text-center">
    <p className="pad super-faint text-sm text-center">
      <i className="fa fa-unlock-alt" style={{ fontSize: '8rem', opacity: 0.3 }} />
      <br /><br />
      No auth strategies. Use the Auth dropdown above to add one.
    </p>
  </div>
);

export const AuthWrapper: FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  const { activeRequest } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const { requestId } = useParams() as { requestId: string };
  const patchRequest = useRequestSetter();
  const strategies = getAuthStrategies(activeRequest.authentication);
  console.log('[AuthWrapper]', { requestId, authentication: activeRequest.authentication, strategies, count: strategies.length });

  const patchStrategy = useCallback(
    (index: number, patch: Partial<RequestAuthenticationStrategy>) =>
      patchRequest(requestId, { authentication: patchAuthStrategy(activeRequest.authentication, index, patch) }),
    [activeRequest.authentication, patchRequest, requestId],
  );

  const removeStrategy = useCallback(
    (index: number) =>
      patchRequest(requestId, { authentication: removeAuthStrategy(activeRequest.authentication, index) }),
    [activeRequest.authentication, patchRequest, requestId],
  );

  if (strategies.length === 0) {
    return <EmptyState />;
  }

  return (
    <div>
      {strategies.map((strategy, index) => (
        <AuthStrategyProvider
          key={`${strategy.type || 'none'}-${index}`}
          strategy={strategy}
          strategyIndex={index}
          patch={p => patchStrategy(index, p)}
        >
          <div className="border-bottom pad-bottom">
            <div className="flex flex--center pad-top pad-left pad-right">
              <strong className="txt-sm">
                {getAuthTypeName(strategy.type as any, true) || 'Auth'}
              </strong>
              <input
                className="margin-left form-control form-control--small flex-1"
                placeholder="Header name override (defaults to Authorization)"
                value={strategy.headerName || ''}
                onChange={e => patchStrategy(index, { headerName: e.target.value || undefined })}
                disabled={disabled}
                title="Override the destination header for this strategy (e.g., X-Goog-IAP-JWT-Assertion)"
              />
              <button
                className="btn btn--super-duper-compact btn--clicky margin-left-xs"
                onClick={() => removeStrategy(index)}
                disabled={disabled}
                title="Remove this auth strategy"
              >
                <i className="fa fa-trash-o" />
              </button>
            </div>
            {renderEditor(strategy.type as string, disabled)}
          </div>
        </AuthStrategyProvider>
      ))}
    </div>
  );
};
