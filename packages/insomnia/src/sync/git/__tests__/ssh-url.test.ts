import { describe, expect, it } from '@jest/globals';

import { isSshTransportUrl, isSshUrl, parseSshUrl, remoteUrlFor, sshRequestOf } from '../ssh-url';

describe('parseSshUrl', () => {
  it('reads the scp-like form', () => {
    expect(parseSshUrl('git@github.com:acme/api.git')).toEqual({ user: 'git', host: 'github.com', port: 0, path: 'acme/api.git' });
    expect(parseSshUrl('work-github:acme/api.git')).toEqual({ user: '', host: 'work-github', port: 0, path: 'acme/api.git' });
  });

  it('reads ssh:// addresses, with a port, and git\'s other spellings', () => {
    expect(parseSshUrl('ssh://git@gitlab.example.com:2222/team/api.git')).toEqual({ user: 'git', host: 'gitlab.example.com', port: 2222, path: '/team/api.git' });
    expect(parseSshUrl('git+ssh://git@bitbucket.org/team/api.git')).toMatchObject({ host: 'bitbucket.org', port: 0, path: '/team/api.git' });
    expect(parseSshUrl('ssh://git@[::1]:2222/api.git')).toMatchObject({ host: '::1', port: 2222 });
    // ~ is a home, as git takes it
    expect(parseSshUrl('ssh://kim@host/~kim/api.git')).toMatchObject({ path: '~kim/api.git' });
  });

  it('keeps a user with a % that starts no valid escape as typed', () => {
    expect(parseSshUrl('ssh://%@host/api.git')).toEqual({ user: '%', host: 'host', port: 0, path: '/api.git' });
    expect(parseSshUrl('ssh://kim%E0%A4%A@host/api.git')).toMatchObject({ user: 'kim%E0%A4%A' });
    expect(parseSshUrl('ssh://kim%40work@host/api.git')).toMatchObject({ user: 'kim@work' });
    expect(isSshUrl('ssh://%@host/api.git')).toBe(true);
  });

  it('takes nothing else for SSH', () => {
    for (const url of ['https://github.com/acme/api.git', 'http://host:8080/api.git', '/srv/git/api.git', 'C:\\repos\\api', 'file:///srv/api.git', '']) {
      expect([url, isSshUrl(url)]).toEqual([url, false]);
    }
  });
});

describe('remoteUrlFor', () => {
  it('leaves an https:// address as it is', () => {
    expect(remoteUrlFor('https://github.com/acme/api.git')).toBe('https://github.com/acme/api.git');
  });

  it("gives isomorphic-git an SSH address as https://, and reads its requests back", () => {
    const url = remoteUrlFor('git@github.com:acme/api.git');
    expect(isSshTransportUrl(url)).toBe(true);
    // as isomorphic-git asks for refs, then fetches and pushes
    expect(sshRequestOf(`${url}/info/refs?service=git-upload-pack`)).toEqual({ sshUrl: 'git@github.com:acme/api.git', service: 'git-upload-pack', advertisement: true });
    expect(sshRequestOf(`${url}/git-upload-pack`)).toEqual({ sshUrl: 'git@github.com:acme/api.git', service: 'git-upload-pack', advertisement: false });
    expect(sshRequestOf(`${url}/git-receive-pack`)).toMatchObject({ service: 'git-receive-pack', advertisement: false });
  });

  it("doesn't take another host, or another service", () => {
    expect(sshRequestOf('https://github.com/acme/api.git/info/refs?service=git-upload-pack')).toBeNull();
    expect(sshRequestOf(`${remoteUrlFor('git@github.com:acme/api.git')}/info/refs?service=git-upload-archive`)).toBeNull();
    expect(isSshTransportUrl('https://github.com/acme/api.git')).toBe(false);
    // a % that starts no valid escape
    expect(sshRequestOf('https://ssh.insomnium.invalid/%E0%A4%A/info/refs?service=git-upload-pack')).toBeNull();
  });
});
