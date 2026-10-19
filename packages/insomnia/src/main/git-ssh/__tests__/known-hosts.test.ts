/**
 * @jest-environment node
 */
import crypto from 'crypto';

import { describe, expect, it } from '@jest/globals';
import { type ParsedKey, utils } from 'ssh2';

import { flushEnd } from '../transport';
import { checkHostKey, fingerprint, keyType, knownHostsLine } from '../known-hosts';
import { hostConfig } from '../ssh-config';

const wireKey = () => (utils.parseKey(utils.generateKeyPairSync('ed25519').public) as ParsedKey).getPublicSSH();
const hashed = (name: string) => {
  const salt = crypto.randomBytes(20);
  return `|1|${salt.toString('base64')}|${crypto.createHmac('sha1', salt).update(name).digest('base64')}`;
};
const file = (text: string) => [{ path: '/home/kim/.ssh/known_hosts', text }];

describe('checkHostKey', () => {
  const key = wireKey();
  const base64 = key.toString('base64');

  it('knows a host by name, by [host]:port off 22, hashed, and by wildcard', () => {
    expect(checkHostKey(file(`github.com ssh-ed25519 ${base64}`), 'github.com', 22, key)).toEqual({ status: 'known' });
    expect(checkHostKey(file(`[git.example.com]:2222 ssh-ed25519 ${base64}`), 'git.example.com', 2222, key)).toEqual({ status: 'known' });
    expect(checkHostKey(file(`git.example.com ssh-ed25519 ${base64}`), 'git.example.com', 2222, key).status).toBe('unknown');
    expect(checkHostKey(file(`${hashed('github.com')} ssh-ed25519 ${base64}`), 'github.com', 22, key)).toEqual({ status: 'known' });
    expect(checkHostKey(file(`*.example.com,!bad.example.com ssh-ed25519 ${base64}`), 'git.example.com', 22, key)).toEqual({ status: 'known' });
    expect(checkHostKey(file(`*.example.com,!bad.example.com ssh-ed25519 ${base64}`), 'bad.example.com', 22, key).status).toBe('unknown');
  });

  it('refuses a host listed with another key of the same type, naming the line', () => {
    const text = `# mine\ngitlab.com ssh-ed25519 ${wireKey().toString('base64')}\ngithub.com ssh-ed25519 ${wireKey().toString('base64')}`;
    expect(checkHostKey(file(text), 'github.com', 22, key)).toEqual({ status: 'changed', file: '/home/kim/.ssh/known_hosts', line: 3 });
  });

  it("asks about a host known only with other types of key, and about a revoked one it doesn't", () => {
    expect(checkHostKey(file('github.com ssh-rsa AAAAB3NzaC1yc2E='), 'github.com', 22, key)).toEqual({ status: 'unknown', otherTypesKnown: true });
    expect(checkHostKey(file(`@revoked * ssh-ed25519 ${base64}\ngithub.com ssh-ed25519 ${base64}`), 'github.com', 22, key)).toEqual({ status: 'revoked', file: '/home/kim/.ssh/known_hosts', line: 1 });
    // a certificate authority's key isn't the host's
    expect(checkHostKey(file(`@cert-authority github.com ssh-ed25519 ${base64}`), 'github.com', 22, key).status).toBe('unknown');
  });

  it('writes a line that it then knows, and shows the key as ssh does', () => {
    expect(checkHostKey(file(knownHostsLine('127.0.0.1', 2222, key)), '127.0.0.1', 2222, key)).toEqual({ status: 'known' });
    expect(keyType(key)).toBe('ssh-ed25519');
    expect(fingerprint(key)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
});

describe('hostConfig', () => {
  const config = [
    'IdentityFile ~/.ssh/everywhere',
    '',
    'Host work-github',
    '  HostName github.com',
    '  User git',
    '  IdentityFile ~/.ssh/work_ed25519',
    '',
    'Host *.internal !build.internal',
    '  Port 2222',
    '',
    'Match host github.com',
    '  User nobody',
    '',
    'Host *',
    '  User fallback',
    '  Port=22',
  ].join('\n');

  it('takes the first value of each setting, from the blocks that match', () => {
    expect(hostConfig(config, 'work-github', '/home/kim')).toEqual({
      hostName: 'github.com',
      user: 'git',
      port: 22,
      identityFiles: ['/home/kim/.ssh/everywhere', '/home/kim/.ssh/work_ed25519'],
    });
    expect(hostConfig(config, 'git.internal', '/home/kim')).toMatchObject({ port: 2222, user: 'fallback' });
    expect(hostConfig(config, 'build.internal', '/home/kim')).toMatchObject({ port: 22 });
  });
});

describe('flushEnd', () => {
  it('finds the end of an advertisement, once it has all come', () => {
    const line = `${'ab'.repeat(20)} refs/heads/main\n`;
    const advertisement = Buffer.from(`${(line.length + 4).toString(16).padStart(4, '0')}${line}0000`);
    expect(flushEnd(advertisement)).toBe(advertisement.length);
    expect(flushEnd(advertisement.subarray(0, 30))).toBe(-1);
    expect(() => flushEnd(Buffer.from('Permission denied'))).toThrow('something other than git');
  });
});
