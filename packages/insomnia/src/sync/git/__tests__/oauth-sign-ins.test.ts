import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { moveSignInsFromLocalStorage } from '../oauth-sign-ins';
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

describe('repositories set up with a GitHub or GitLab sign-in', () => {
  beforeEach(globalBeforeEach);

  it("get the sign-in's tokens localStorage still has, which are then removed", async () => {
    const github = await models.gitRepository.create({ uri: 'https://github.com/a/b', credentials: { oauth2format: 'github', username: 'gho_old', token: 'gho_old' } });
    const gitlab = await models.gitRepository.create({ uri: 'https://gitlab.com/a/b', credentials: { oauth2format: 'gitlab', username: 'glo_old', token: 'glo_old' } });
    const other = await models.gitRepository.create({ uri: 'https://example.com/a/b', credentials: { username: 'kim', password: 'pat' } });
    const local = storage({ 'github-oauth-token': 'gho_new', 'gitlab-oauth-token': 'glo_new', 'gitlab-oauth-refresh-token': 'glr_new', theme: 'dark' });

    await moveSignInsFromLocalStorage(local);

    expect(await credentialsOf(github._id)).toEqual({ oauth2format: 'github', username: 'gho_new', token: 'gho_new' });
    expect(await credentialsOf(gitlab._id)).toEqual({ oauth2format: 'gitlab', username: 'glo_new', token: 'glo_new' });
    expect(await credentialsOf(other._id)).toEqual({ username: 'kim', password: 'pat' });
    expect([...local.kept.keys()]).toEqual(['theme']);
  });

  it('send their token to git as each host expects it', async () => {
    const github = gitCallbacks({ oauth2format: 'github', username: 'gho_1', token: 'gho_1' });
    const gitlab = gitCallbacks({ oauth2format: 'gitlab', username: 'glo_1', token: 'glo_1' });

    expect(await github.onAuth('https://github.com/a/b', {})).toEqual({ username: 'gho_1', password: 'x-oauth-basic' });
    expect(await gitlab.onAuth('https://gitlab.com/a/b', {})).toEqual({ username: 'oauth2', password: 'glo_1' });
  });
});
