// Repositories once set up with a GitHub or GitLab sign-in (through Kong's
// servers; Insomnium no longer offers it) keep its token in their credentials,
// which are stored encrypted (common/credential-guard.ts), and git still uses
// it (utils.ts). The sign-in kept its tokens in the window's localStorage as
// well, in plaintext, and git used those over the repository's.
import * as models from '../../models';
import type { GitRepository } from '../../models/git-repository';

const GITHUB_TOKEN = 'github-oauth-token';
const GITLAB_TOKEN = 'gitlab-oauth-token';
const GITLAB_REFRESH_TOKEN = 'gitlab-oauth-refresh-token';

const signedInWith = (repository: GitRepository, format: 'github' | 'gitlab') => {
  const { credentials } = repository;
  return credentials && 'oauth2format' in credentials && credentials.oauth2format === format ? credentials : null;
};

// The tokens localStorage still has: into the repositories of that sign-in,
// as git used them for those, then removed (with the GitLab refresh token,
// which nothing can use now)
export async function moveSignInsFromLocalStorage(storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage) {
  const tokens = { github: storage.getItem(GITHUB_TOKEN), gitlab: storage.getItem(GITLAB_TOKEN) };
  if (!tokens.github && !tokens.gitlab && !storage.getItem(GITLAB_REFRESH_TOKEN)) {
    return;
  }
  for (const repository of await models.gitRepository.all()) {
    for (const format of ['github', 'gitlab'] as const) {
      const signIn = signedInWith(repository, format);
      const token = tokens[format];
      if (signIn && token && signIn.token !== token) {
        await models.gitRepository.update(repository, {
          // such a sign-in's username is its token
          credentials: { ...signIn, token, ...(signIn.username === signIn.token ? { username: token } : {}) },
        });
      }
    }
  }
  for (const key of [GITHUB_TOKEN, GITLAB_TOKEN, GITLAB_REFRESH_TOKEN]) {
    storage.removeItem(key);
  }
}
