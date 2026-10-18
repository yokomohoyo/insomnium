import React, { FC } from 'react';

import { JWS_KEY_ALGORITHMS, JWS_SECRET_ALGORITHMS } from '../../../../network/jws';
import { useAuthStrategy } from './auth-strategy-context';
import { AuthInputRow } from './components/auth-input-row';
import { AuthPrivateKeyRow } from './components/auth-private-key-row';
import { AuthSelectRow } from './components/auth-select-row';
import { AuthTableBody } from './components/auth-table-body';
import { AuthToggleRow } from './components/auth-toggle-row';

const algorithms = [...JWS_SECRET_ALGORITHMS, ...JWS_KEY_ALGORITHMS].map(algorithm => ({ name: algorithm, value: algorithm }));
const places = [{ name: 'Header', value: 'header' }, { name: 'Query parameter', value: 'queryParams' }];

// A JWT signed on each send (network/jwt-auth.ts), from these claims
export const JwtAuth: FC = () => {
  const { strategy } = useAuthStrategy();
  const withSecret = JWS_SECRET_ALGORITHMS.includes(strategy.algorithm || 'HS256');
  const inQuery = strategy.addTo === 'queryParams';
  return (
    <AuthTableBody>
      <AuthToggleRow label="Enabled" property="disabled" invert />
      <AuthSelectRow label='Algorithm' property='algorithm' options={algorithms} />
      {withSecret ? (
        <>
          <AuthInputRow label='Secret' property='secret' mask />
          <AuthToggleRow label='Secret is Base64' property='secretBase64' onTitle='The secret is the text as written' offTitle='Decode the secret from Base64' />
        </>
      ) : (
        <AuthPrivateKeyRow label='Private Key' property='privateKey' help='The PEM private key to sign with' />
      )}
      <AuthInputRow label='Payload' property='payload' help='The claims, as JSON, such as { "sub": "{{ user }}" }. iat is set for you, and exp from the lifetime below, unless the payload has them.' />
      <AuthInputRow label='Lifetime (seconds)' property='expiresIn' help='Sets exp this long after iat; leave empty for no exp' />
      <AuthInputRow label='Header' property='header' help='More of the JWT header, as JSON, such as { "kid": "key-1" }; alg and typ are set for you' />
      <AuthSelectRow label='Add To' property='addTo' options={places} />
      {inQuery ? (
        <AuthInputRow label='Query Parameter' property='queryParamKey' />
      ) : (
        <AuthInputRow label='Header Prefix' property='prefix' help='"Bearer" by default; NO_PREFIX sends the token alone' />
      )}
    </AuthTableBody>
  );
};
