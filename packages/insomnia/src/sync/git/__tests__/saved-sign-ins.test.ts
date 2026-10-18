import { describe, expect, it } from '@jest/globals';

import type { GitRepository } from '../../../models/git-repository';
import { gitHostOf, savedGitSignIns } from '../saved-sign-ins';

const repository = (uri: string, credentials: GitRepository['credentials']) => ({ uri, credentials }) as GitRepository;

describe('gitHostOf()', () => {
  it.each([
    ['https://GitHub.com/org/repo.git', 'github.com'],
    ['git@gitlab.example.com:group/repo.git', 'gitlab.example.com'],
    ['ssh://git@bitbucket.org/team/repo.git', 'bitbucket.org'],
    ['https://user@git.example.com:8443/repo', 'git.example.com'],
    ['not a url', ''],
  ])('%s is on %s', (uri, host) => {
    expect(gitHostOf(uri)).toBe(host);
  });
});

describe('savedGitSignIns()', () => {
  it('offers each username and token once per host, and nothing without one', () => {
    expect(savedGitSignIns([
      repository('https://github.com/org/one.git', { username: 'kim', password: 'ghp_1' }),
      repository('https://github.com/org/two.git', { username: 'kim', password: 'ghp_2' }),
      repository('git@gitlab.example.com:group/repo.git', { username: 'kim', password: 'glpat' }),
      // public, and signed in through a provider
      repository('https://github.com/org/public.git', { username: '', password: '' }),
      repository('https://github.com/org/oauth.git', { username: 'kim', token: 'gho', oauth2format: 'github' }),
      repository('https://github.com/org/none.git', null),
    ])).toEqual([
      { host: 'github.com', username: 'kim', token: 'ghp_2' },
      { host: 'gitlab.example.com', username: 'kim', token: 'glpat' },
    ]);
  });
});
