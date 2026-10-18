// GitHub and GitLab sign-ins keep their tokens with the repositories signed in
// with them: in GitRepository credentials, which are stored encrypted
// (common/credential-guard.ts). They used to be kept in the window's
// localStorage as well, in plaintext, and git used those over the repository's.
import * as models from '../../models';
import type { GitRepository } from '../../models/git-repository';
import { GITHUB_TOKEN_STORAGE_KEY } from './github-oauth-provider';
import { GITLAB_REFRESH_TOKEN_STORAGE_KEY, GITLAB_TOKEN_STORAGE_KEY } from './gitlab-oauth-provider';

const signedInWith = (repository: GitRepository, format: 'github' | 'gitlab') => {
  const { credentials } = repository;
  return credentials && 'oauth2format' in credentials && credentials.oauth2format === format ? credentials : null;
};

// The tokens localStorage still has: into the repositories of that sign-in,
// as git used them for those, then removed
export async function moveSignInsFromLocalStorage(storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage) {
  const github = storage.getItem(GITHUB_TOKEN_STORAGE_KEY);
  const gitlab = storage.getItem(GITLAB_TOKEN_STORAGE_KEY);
  const gitlabRefresh = storage.getItem(GITLAB_REFRESH_TOKEN_STORAGE_KEY);
  if (!github && !gitlab && !gitlabRefresh) {
    return;
  }
  for (const repository of await models.gitRepository.all()) {
    const githubSignIn = signedInWith(repository, 'github');
    if (githubSignIn && github) {
      await models.gitRepository.update(repository, {
        // a GitHub sign-in's username is its token
        credentials: { ...githubSignIn, token: github, ...(githubSignIn.username === githubSignIn.token ? { username: github } : {}) },
      });
    }
    const gitlabSignIn = signedInWith(repository, 'gitlab');
    if (gitlabSignIn && (gitlab || gitlabRefresh)) {
      await models.gitRepository.update(repository, {
        credentials: {
          ...gitlabSignIn,
          ...(gitlab ? { token: gitlab } : {}),
          ...(gitlab && gitlabSignIn.username === gitlabSignIn.token ? { username: gitlab } : {}),
          ...(gitlabRefresh ? { refreshToken: gitlabRefresh } : {}),
        },
      });
    }
  }
  for (const key of [GITHUB_TOKEN_STORAGE_KEY, GITLAB_TOKEN_STORAGE_KEY, GITLAB_REFRESH_TOKEN_STORAGE_KEY]) {
    storage.removeItem(key);
  }
}

// A GitLab sign-in's tokens, refreshed: kept by the repositories that had the old ones
export async function saveRefreshedGitLabSignIn(oldToken: string, token: string, refreshToken: string) {
  for (const repository of await models.gitRepository.all()) {
    const signIn = signedInWith(repository, 'gitlab');
    if (signIn && signIn.token === oldToken) {
      await models.gitRepository.update(repository, {
        credentials: { ...signIn, token, refreshToken, ...(signIn.username === oldToken ? { username: token } : {}) },
      });
    }
  }
}
