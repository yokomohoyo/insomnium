import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { setAccessToken as signInToGitHub, signOut as signOutOfGitHub } from '../github-oauth-provider';
import { moveSignInsFromLocalStorage, saveRefreshedGitLabSignIn } from '../oauth-sign-ins';
import { gitCallbacks } from '../utils';

const storage = (items: Record<string, string>) => {
  const kept = new Map(Object.entries(items));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    removeItem: (key: string) => void kept.delete(key),
    kept,
  };
};
const credentialsOf = async (id: string) => (await models.gitRepository.getById(id))?.credentials;

describe('GitHub and GitLab sign-ins', () => {
  beforeEach(globalBeforeEach);

  it('move their tokens out of localStorage into the repositories signed in with them, once', async () => {
    const github = await models.gitRepository.create({ uri: 'https://github.com/a/b', credentials: { oauth2format: 'github', username: 'gho_old', token: 'gho_old' } });
    const gitlab = await models.gitRepository.create({ uri: 'https://gitlab.com/a/b', credentials: { oauth2format: 'gitlab', username: 'glo_old', token: 'glo_old' } });
    const other = await models.gitRepository.create({ uri: 'https://example.com/a/b', credentials: { username: 'kim', password: 'pat' } });
    const local = storage({ 'github-oauth-token': 'gho_new', 'gitlab-oauth-token': 'glo_new', 'gitlab-oauth-refresh-token': 'glr_new', theme: 'dark' });

    await moveSignInsFromLocalStorage(local);

    expect(await credentialsOf(github._id)).toEqual({ oauth2format: 'github', username: 'gho_new', token: 'gho_new' });
    expect(await credentialsOf(gitlab._id)).toEqual({ oauth2format: 'gitlab', username: 'glo_new', token: 'glo_new', refreshToken: 'glr_new' });
    expect(await credentialsOf(other._id)).toEqual({ username: 'kim', password: 'pat' });
    expect([...local.kept.keys()]).toEqual(['theme']);
  });

  it("keep a GitLab sign-in's refreshed tokens with its repositories", async () => {
    const signedIn = await models.gitRepository.create({ uri: 'https://gitlab.com/a/b', credentials: { oauth2format: 'gitlab', username: 'glo_1', token: 'glo_1', refreshToken: 'glr_1' } });
    const another = await models.gitRepository.create({ uri: 'https://gitlab.com/c/d', credentials: { oauth2format: 'gitlab', username: 'glo_x', token: 'glo_x', refreshToken: 'glr_x' } });

    await saveRefreshedGitLabSignIn('glo_1', 'glo_2', 'glr_2');

    expect(await credentialsOf(signedIn._id)).toEqual({ oauth2format: 'gitlab', username: 'glo_2', token: 'glo_2', refreshToken: 'glr_2' });
    expect(await credentialsOf(another._id)).toEqual({ oauth2format: 'gitlab', username: 'glo_x', token: 'glo_x', refreshToken: 'glr_x' });
  });

  it("are used for git as their repository keeps them, not a sign-in's", async () => {
    signInToGitHub('gho_signed_in');
    const { onAuth } = gitCallbacks({ oauth2format: 'github', username: 'gho_repo', token: 'gho_repo' });

    expect(await onAuth('https://github.com/a/b', {})).toEqual({ username: 'gho_repo', password: 'x-oauth-basic' });
    expect(window.localStorage.getItem('github-oauth-token')).toBeNull();
    signOutOfGitHub();
  });
});
