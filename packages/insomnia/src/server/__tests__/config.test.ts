import { describe, expect, it } from '@jest/globals';

import { parseConfig } from '../config';

const token = 'x'.repeat(32);
const env = { INSOMNIUM_MCP_TOKEN: token, INSOMNIUM_ALLOWED_HOSTS: 'api.example.com, *.internal.example.com' };

describe('parseConfig()', () => {
  it('reads the options and the environment', () => {
    expect(parseConfig(['--collection', 'a.yaml', '--collection', 'b.json', '--env', 'staging', '--port', '9000'], {
      ...env,
      INSOMNIUM_HOST: '0.0.0.0',
      INSOMNIUM_VAR_apiKey: 'k3y',
      INSOMNIUM_VAR_: 'ignored',
      INSOMNIUM_VALIDATE_SSL: 'false',
      INSOMNIUM_ALLOWED_ENV: 'API_TOKEN, CI_*',
      INSOMNIUM_ALLOWED_SECRETS: 'op://CI/*',
    })).toEqual({
      collections: ['a.yaml', 'b.json'],
      repos: [],
      pullInterval: 300,
      environment: 'staging',
      host: '0.0.0.0',
      port: 9000,
      token,
      allowedHosts: ['api.example.com', '*.internal.example.com'],
      variables: { apiKey: 'k3y' },
      validateSSL: false,
      allowedEnvironmentVariables: 'API_TOKEN, CI_*',
      allowedSecrets: 'op://CI/*',
    });
  });

  it('listens on loopback, port 8080, validates certificates and allows no environment variables by default', () => {
    expect(parseConfig(['--collection', 'a.yaml'], env)).toMatchObject({ host: '127.0.0.1', port: 8080, validateSSL: true, variables: {}, allowedEnvironmentVariables: '' });
  });

  it('updates the repositories every 300 s unless told otherwise, as often as a timer can wait', () => {
    const pullInterval = (argv: string[], value?: string) => parseConfig(['--repo', 'r', ...argv], { ...env, INSOMNIUM_PULL_INTERVAL: value }).pullInterval;
    expect(pullInterval([])).toBe(300);
    expect(pullInterval([], '')).toBe(300);
    expect(pullInterval([], '0')).toBe(0);
    expect(pullInterval(['--pull-interval', '2147483'])).toBe(2147483);
  });

  it.each([
    ['no collection', [], env, /--collection or --repo/],
    ['a bad pull interval', ['--repo', 'r', '--pull-interval', '-1'], env, /--pull-interval/],
    ['a pull interval longer than a timer waits', ['--repo', 'r', '--pull-interval', '2147484'], env, /--pull-interval/],
    ['a bad pull interval from the environment', ['--repo', 'r'], { ...env, INSOMNIUM_PULL_INTERVAL: 'often' }, /--pull-interval/],
    ['an option without its value', ['--collection'], env, /needs a value/],
    ['an unknown option', ['--collection', 'a', '--verbose'], env, /Unknown option --verbose/],
    ['a bad port', ['--collection', 'a', '--port', '70000'], env, /port/],
    ['a short token', ['--collection', 'a'], { ...env, INSOMNIUM_MCP_TOKEN: 'short' }, /INSOMNIUM_MCP_TOKEN/],
    ['no allowed hosts', ['--collection', 'a'], { ...env, INSOMNIUM_ALLOWED_HOSTS: ' , ' }, /INSOMNIUM_ALLOWED_HOSTS/],
  ])('refuses %s', (_, argv, environment, message) => {
    expect(() => parseConfig(argv as string[], environment)).toThrow(message);
  });
});
