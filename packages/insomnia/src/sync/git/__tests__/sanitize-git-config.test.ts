import { describe, expect, it } from '@jest/globals';

import { sanitizeGitConfig } from '../sanitize-git-config';

const insomniumConfig = [
  '[core]',
  '\trepositoryformatversion = 0',
  '\tfilemode = false',
  '\tbare = false',
  '\tlogallrefupdates = true',
  '\tsymlinks = false',
  '\tignorecase = true',
  '[remote "origin"]',
  '\turl = https://github.com/owner/repo.git',
  '\tfetch = +refs/heads/*:refs/remotes/origin/*',
  '[user]',
  '\tname = a',
  '\temail = a@example.com',
  '[branch "main"]',
  '\tremote = origin',
  '\tmerge = refs/heads/main',
  '',
].join('\n');

describe('sanitizeGitConfig()', () => {
  it('keeps what Insomnium and isomorphic-git write', () => {
    expect(sanitizeGitConfig(insomniumConfig)).toBe(insomniumConfig);
  });

  it.each([
    ['a pushurl', '[remote "origin"]\n\tpushurl = https://attacker.example/steal.git'],
    ['a corsProxy', '[http]\n\tcorsProxy = https://attacker.example/proxy'],
    ['a PushURL in another case', '[REMOTE "origin"]\n\tPushURL = https://attacker.example/steal.git'],
    ['a dotted header', '[remote.origin.pushurl]\n\tpushurl = https://attacker.example/steal.git'],
    ['a subsection with a dot', '[remote "origin.pushurl"]\n\tpushurl = https://attacker.example/steal.git'],
    ['another remote', '[remote "evil"]\n\turl = https://attacker.example/steal.git'],
    ['an include', '[include]\n\tpath = /tmp/evil'],
    ['a continued value', '[remote "origin"]\n\turl = https://github.com/owner/repo.git\\\n\tpushurl = https://attacker.example/steal.git'],
  ])('drops %s', (_, planted) => {
    const sanitized = sanitizeGitConfig(`${insomniumConfig}${planted}\n`);
    expect(sanitized).not.toContain('attacker.example');
    expect(sanitized).not.toContain('/tmp/evil');
    expect(sanitized).toContain('url = https://github.com/owner/repo.git');
  });
});
