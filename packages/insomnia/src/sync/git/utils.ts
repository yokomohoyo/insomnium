import { AuthCallback, AuthFailureCallback, AuthSuccessCallback, GitAuth, MessageCallback } from 'isomorphic-git';

import type { GitCredentials } from './git-vcs';
import { SSH_KEY_HEADER, SSH_PASSPHRASE_HEADER } from './ssh-url';

export const addDotGit = (url: string): string => (url.endsWith('.git') ? url : `${url}.git`);

const onMessage: MessageCallback = message => {
  console.log(`[git-event] ${message}`);
};

const onAuthFailure: AuthFailureCallback = message => {
  console.log(`[git-event] Auth Failure: ${message}`);
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

// the GitHub or GitLab sign-in a repository was set up with, once
export const getOauth2FormatName = (credentials?: GitCredentials | null): 'github' | 'gitlab' | undefined => {
  if (credentials && 'oauth2format' in credentials) {
    return credentials.oauth2format;
  }

  return;
};

// an SSH key's settings, which ride with each request to the main process (http-client.ts drops them for HTTP)
const sshHeaders = (credentials?: GitCredentials | null) => {
  if (!credentials || !('sshKey' in credentials) || !credentials.sshKey) {
    return {};
  }
  return { headers: { [SSH_KEY_HEADER]: credentials.sshKey, [SSH_PASSPHRASE_HEADER]: credentials.sshPassphrase || '' } };
};

export const gitCallbacks = (credentials?: GitCredentials | null) => ({
  onMessage,
  onAuthFailure,
  onAuthSuccess,
  onAuth: onAuth(credentials ?? undefined),
  ...sshHeaders(credentials),
});
