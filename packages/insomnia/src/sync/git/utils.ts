import { AuthCallback, AuthFailureCallback, AuthSuccessCallback, GitAuth, MessageCallback } from 'isomorphic-git';

import { OauthProviderName } from '../../models/git-repository';
import type { GitCredentials } from './git-vcs';
import { refreshToken as refreshGitlabToken } from './gitlab-oauth-provider';
import { saveRefreshedGitLabSignIn } from './oauth-sign-ins';

export const addDotGit = (url: string): string => (url.endsWith('.git') ? url : `${url}.git`);

const onMessage: MessageCallback = message => {
  console.log(`[git-event] ${message}`);
};

const onAuthFailure =
  (credentials?: GitCredentials): AuthFailureCallback =>
    async (message, auth) => {
      console.log(`[git-event] Auth Failure: ${message}`);

      // Try to refresh the token if auth failed.
      // Whenever we return a new GitAuth object from this function
      // isomorphic-git will retry the request with the new credentials.
      // https://isomorphic-git.org/docs/en/onAuthFailure#docsNav
      if (
        credentials &&
      'oauth2format' in credentials &&
      credentials.oauth2format === 'gitlab' &&
      credentials.refreshToken
      ) {
        console.log('[git-event] Attempting to refresh token');
        try {
          const old = credentials.token;
          const refreshed = await refreshGitlabToken(credentials.refreshToken);
          if (refreshed.token) {
            console.log('[git-event] Token refreshed');
            // used from now on, and kept by the repositories of this sign-in
            Object.assign(credentials, refreshed);
            await saveRefreshedGitLabSignIn(old, refreshed.token, refreshed.refreshToken);
            return {
              ...auth,
              password: refreshed.token,
              headers: {
                ...auth.headers,
                Authorization: `Bearer ${refreshed.token}`,
              },
            };
          }
        } catch (error) {
          console.warn('[git-event] Failed to refresh token', error);
          return;
        }
      }

      return;
    };

const onAuthSuccess: AuthSuccessCallback = message => {
  console.log(`[git-event] Auth Success: ${message}`);
};

const onAuth = (credentials?: GitCredentials): AuthCallback => (): GitAuth => {
  if (!credentials) {
    console.log('[git-event] No credentials');
    return {
      username: '',
      password: '',
    };
  }

  if ('oauth2format' in credentials) {
    console.log('[git-event] Using OAuth2 credentials');

    // the repository's own token (stored encrypted)
    if (credentials.oauth2format === 'github') {
      return {
        username: credentials.token,
        password: 'x-oauth-basic',
      };
    }

    if (credentials.oauth2format === 'gitlab') {
      return {
        username: 'oauth2',
        password: credentials.token,
      };
    }
  }

  console.log('[git-event] Using basic auth credentials');
  return {
    username: credentials.username,
    // @ts-expect-error -- TSCONVERSION this needs to be handled better if credentials is undefined or which union type
    password: credentials.password || credentials.token,
  };
};

export const getOauth2FormatName = (credentials?: GitCredentials | null): OauthProviderName | undefined => {
  if (credentials && 'oauth2format' in credentials) {
    return credentials.oauth2format;
  }

  return;
};

export const gitCallbacks = (credentials?: GitCredentials | null) => ({
  onMessage,
  onAuthFailure: onAuthFailure(credentials ?? undefined),
  onAuthSuccess,
  onAuth: onAuth(credentials ?? undefined),
});
