/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { allowedNames, isAllowed, readEnvironmentVariable } from '../os-environment';

describe('isAllowed()', () => {
  it('matches names, and prefixes ending in *', () => {
    const allowed = allowedNames(' API_TOKEN,STAGING_*\nCI ');
    expect(allowed).toEqual(['API_TOKEN', 'STAGING_*', 'CI']);
    expect(isAllowed('API_TOKEN', allowed)).toBe(true);
    expect(isAllowed('STAGING_HOST', allowed)).toBe(true);
    expect(isAllowed('CI', allowed)).toBe(true);
    expect(isAllowed('API_TOKEN_2', allowed)).toBe(false);
    expect(isAllowed('CI_JOB', allowed)).toBe(false);
    expect(isAllowed('HOME', allowed)).toBe(false);
  });

  it('allows none when empty, and any with a lone *', () => {
    expect(isAllowed('HOME', allowedNames(''))).toBe(false);
    expect(isAllowed('HOME', allowedNames('*'))).toBe(true);
  });
});

describe('readEnvironmentVariable()', () => {
  let dir: string;
  let dotenvFile: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-dotenv-'));
    dotenvFile = path.join(dir, '.env');
    fs.writeFileSync(dotenvFile, [
      '# a comment',
      'API_TOKEN=from-file',
      'export QUOTED="two words"',
      'MULTI="line one\\nline two"',
      'INLINE=value # a comment',
    ].join('\n'));
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const settings = (allowedEnvironmentVariables: string, file = '') => ({ allowedEnvironmentVariables, dotenvFile: file });

  it('reads an allowed variable from the OS environment', async () => {
    expect(await readEnvironmentVariable('API_TOKEN', settings('API_TOKEN'), { API_TOKEN: 'from-os' })).toBe('from-os');
    expect(await readEnvironmentVariable('EMPTY', settings('EMPTY'), { EMPTY: '' })).toBe('');
  });

  it('refuses a variable the settings do not allow, even when it is set', async () => {
    await expect(readEnvironmentVariable('HOME', settings(''), { HOME: '/home/me' }))
      .rejects.toThrow("HOME isn't an allowed environment variable: add it in Preferences > General > OS Environment Variables");
    await expect(readEnvironmentVariable('HOME', settings('HOMEDIR'), { HOME: '/home/me' })).rejects.toThrow(/isn't an allowed/);
  });

  it('refuses something that is not a variable name', async () => {
    await expect(readEnvironmentVariable('', settings('*'), {})).rejects.toThrow(/isn't an environment variable name/);
    await expect(readEnvironmentVariable('A B', settings('*'), {})).rejects.toThrow(/isn't an environment variable name/);
  });

  it('falls back to the dotenv file, with the OS environment taking precedence', async () => {
    const withFile = settings('*', dotenvFile);
    expect(await readEnvironmentVariable('API_TOKEN', withFile, {})).toBe('from-file');
    expect(await readEnvironmentVariable('API_TOKEN', withFile, { API_TOKEN: 'from-os' })).toBe('from-os');
    expect(await readEnvironmentVariable('QUOTED', withFile, {})).toBe('two words');
    expect(await readEnvironmentVariable('MULTI', withFile, {})).toBe('line one\nline two');
    expect(await readEnvironmentVariable('INLINE', withFile, {})).toBe('value');
  });

  it('says where it looked when nothing sets the variable', async () => {
    await expect(readEnvironmentVariable('NOPE', settings('*'), {})).rejects.toThrow("NOPE isn't set in the environment");
    await expect(readEnvironmentVariable('NOPE', settings('*', dotenvFile), {})).rejects.toThrow(`NOPE isn't set in the environment or ${dotenvFile}`);
  });

  it('needs a full path to the dotenv file, or one from the home directory', async () => {
    await expect(readEnvironmentVariable('X', settings('*', 'relative/.env'), {})).rejects.toThrow(/must be a full path/);
    await expect(readEnvironmentVariable('X', settings('*', '~/insomnium-no-such-dir/.env'), {}))
      .rejects.toThrow(path.join(os.homedir(), 'insomnium-no-such-dir', '.env'));
  });
});
