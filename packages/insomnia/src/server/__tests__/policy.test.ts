import { describe, expect, it } from '@jest/globals';

import { makeHostPolicy } from '../policy';

describe('makeHostPolicy()', () => {
  const policy = makeHostPolicy(['api.example.com', '*.internal.example.com', '10.0.0.5']);

  it.each([
    'https://api.example.com/v1',
    'http://API.example.com:8080/',
    'https://a.internal.example.com/',
    'https://deep.a.internal.example.com/',
    'http://10.0.0.5:3000/',
  ])('allows %s', url => {
    expect(() => policy(url)).not.toThrow();
  });

  it.each([
    ['another host', 'https://example.org/', /not in INSOMNIUM_ALLOWED_HOSTS/],
    ['a lookalike suffix', 'https://evilinternal.example.com/', /not in INSOMNIUM_ALLOWED_HOSTS/],
    ['the wildcard\'s own domain', 'https://internal.example.com/', /not in INSOMNIUM_ALLOWED_HOSTS/],
    ['a unix socket', 'unix:/var/run/docker.sock', /only http and https/],
    ['file', 'file:///etc/passwd', /only http and https/],
  ])('refuses %s', (_, url, message) => {
    expect(() => policy(url)).toThrow(message);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/',
    'http://0xa9fea9fe/',
    'http://metadata.google.internal/',
    'http://[fe80::1]/',
    'http://[fd00:ec2::254]/',
  ])('refuses the cloud metadata host %s, even with *', url => {
    expect(() => makeHostPolicy(['*'])(url)).toThrow(/cloud metadata/);
  });

  it('allows a metadata host that is listed by name', () => {
    expect(() => makeHostPolicy(['169.254.169.254'])('http://169.254.169.254/')).not.toThrow();
  });

  it('allows any other host with *', () => {
    expect(() => makeHostPolicy(['*'])('https://anything.example.net/')).not.toThrow();
  });
});
