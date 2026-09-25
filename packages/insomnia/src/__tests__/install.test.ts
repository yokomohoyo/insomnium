import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import childProcess from 'child_process';
import * as electron from 'electron';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import installPlugin, { containsYarnErrors } from '../main/install-plugin';

// Output captured from bin/yarn-standalone.js (yarn 1.15.2) run with the same
// arguments install-plugin.ts uses.

// `add insomnia-plugin-request`: exit code 0
const ADD_DEPRECATED_STDOUT =
  'yarn add v1.15.2\n' +
  'info No lockfile found.\n' +
  '[1/4] Resolving packages...\n' +
  '[2/4] Fetching packages...\n' +
  '[3/4] Linking dependencies...\n' +
  '[4/4] Building fresh packages...\n' +
  'success Saved 6 new dependencies.\n' +
  'Done in 0.45s.\n';
const ADD_DEPRECATED_STDERR =
  'warning insomnia-plugin-request@3.6.0: Package no longer supported. Use at your own risk.\n' +
  'warning insomnia-plugin-request > insomnia-cookies@3.6.0: Package no longer supported. Use at your own risk.\n' +
  'warning insomnia-plugin-request > insomnia-url@3.6.0: Package no longer supported. Use at your own risk.\n';

// `add react-dom@18.3.1`: exit code 0
const ADD_PEER_STDERR = 'warning " > react-dom@18.3.1" has unmet peer dependency "react@^18.3.1".\n';

// `info insomnia-plugin-request --json` from a directory whose package.json has no license: exit code 0
const INFO_LICENSE_STDERR = '{"type":"warning","data":"package.json: No license field"}\n';

// `info insomnia-plugin-does-not-exist-zzz --json`: exit code 0, empty stdout
const INFO_NOT_FOUND_STDERR = '{"type":"error","data":"Received invalid response from npm."}\n';

// `add insomnia-plugin-request@99.0.0`: exit code 1
const ADD_BAD_VERSION_STDOUT =
  'yarn add v1.15.2\n' +
  'info No lockfile found.\n' +
  '[1/4] Resolving packages...\n' +
  'info Visit https://yarnpkg.com/en/docs/cli/add for documentation about this command.\n';
const ADD_BAD_VERSION_STDERR = 'error Couldn\'t find any versions for "insomnia-plugin-request" that matches "99.0.0"\n';

// `add insomnia-plugin-does-not-exist-zzz`: exit code 1
const ADD_NOT_FOUND_STDERR = 'error An unexpected error occurred: "https://registry.yarnpkg.com/insomnia-plugin-does-not-exist-zzz: Not found".\n';

// `add insomnia-plugin-jq`: exit code 127 (a dependency's install script needs npm)
const ADD_SCRIPT_FAILED_STDERR =
  'warning insomnia-plugin-jq > node-jq > tempfile > uuid@3.4.0: uuid@10 and below is no longer supported.\n' +
  'error /tmp/insomnia-plugin-jq-HYwr/node-jq: Command failed.\n' +
  'Exit code: 127\n' +
  'Command: npm run install-binary\n' +
  'Arguments: \n' +
  'Directory: /tmp/insomnia-plugin-jq-HYwr/node-jq\n' +
  'Output:\n' +
  '/bin/sh: 1: npm: not found\n';

// Format node uses for process warnings that aren't silenced by --no-deprecation
const NODE_WARNING_STDERR = '(node:4242) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to \'0\' makes TLS connections and HTTPS requests insecure by disabling certificate verification.\n';

const PLUGIN_INFO = JSON.stringify({
  type: 'inspect',
  data: {
    name: 'insomnia-plugin-request',
    version: '3.6.0',
    insomnia: { name: 'request', unlisted: true },
    dist: {
      shasum: '557860fa57b40366349c276216104b08923bc9b5',
      tarball: 'https://registry.npmjs.org/insomnia-plugin-request/-/insomnia-plugin-request-3.6.0.tgz',
    },
  },
}) + '\n';

describe('install.js', () => {
  describe('containsYarnErrors', () => {
    it('should return false and log each line when stderr only contains warnings', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const stderr = ADD_DEPRECATED_STDERR + ADD_PEER_STDERR + INFO_LICENSE_STDERR + NODE_WARNING_STDERR;
      expect(containsYarnErrors(stderr)).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(6);
    });

    it('should return true when stderr contains a warning and an error', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const stderr = ADD_DEPRECATED_STDERR.replace(/\n/g, '\r\n') + ADD_BAD_VERSION_STDERR;
      expect(containsYarnErrors(stderr)).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
    });

    it('should return true for yarn errors', () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(containsYarnErrors(ADD_BAD_VERSION_STDERR)).toBe(true);
      expect(containsYarnErrors(ADD_NOT_FOUND_STDERR)).toBe(true);
      expect(containsYarnErrors(INFO_NOT_FOUND_STDERR)).toBe(true);
    });

    it('should not log the rest of a multi-line error as warnings', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(containsYarnErrors(ADD_SCRIPT_FAILED_STDERR)).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^warning insomnia-plugin-jq > /));
    });

    it('should return false for empty stderr', () => {
      expect(containsYarnErrors('')).toBe(false);
    });
  });

  describe('installPlugin', () => {
    interface YarnResult {
      exitCode: number;
      stdout: string;
      stderr: string;
    }

    let dataPath: string;
    let info: YarnResult;
    let add: YarnResult;

    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      dataPath = mkdtempSync(path.join(os.tmpdir(), 'insomnia-install-plugin-'));
      process.env['INSOMNIA_DATA_PATH'] = dataPath;
      // @ts-expect-error -- not part of the electron mock
      electron.app.getAppPath = () => '/app';
      info = { exitCode: 0, stdout: PLUGIN_INFO, stderr: '' };
      add = { exitCode: 0, stdout: ADD_DEPRECATED_STDOUT, stderr: '' };

      // Replays the yarn output and, when the add succeeded, lays out the modules folder like yarn does
      jest.spyOn(childProcess, 'execFile').mockImplementation(((_file: string, args: string[], options: { cwd?: string }, callback: Function) => {
        const result = args.includes('info') ? info : add;
        if (args.includes('add') && result.stdout.includes('success') && options.cwd) {
          mkdirSync(path.join(options.cwd, 'insomnia-plugin-request'));
          writeFileSync(path.join(options.cwd, 'insomnia-plugin-request', 'package.json'), '{}');
          mkdirSync(path.join(options.cwd, 'tough-cookie'));
        }
        const err = result.exitCode ? Object.assign(new Error(`Command failed\n${result.stderr}`), { code: result.exitCode }) : null;
        callback(err, result.stdout, result.stderr);
        return {} as childProcess.ChildProcess;
      }) as any);
    });

    afterEach(() => {
      delete process.env['INSOMNIA_DATA_PATH'];
      rmSync(dataPath, { recursive: true, force: true });
      jest.restoreAllMocks();
    });

    it('should install a plugin when yarn prints deprecation warnings', async () => {
      add.stderr = ADD_DEPRECATED_STDERR;
      await expect(installPlugin('insomnia-plugin-request')).resolves.toBeUndefined();
      const pluginDir = path.join(dataPath, 'plugins', 'insomnia-plugin-request');
      expect(existsSync(path.join(pluginDir, 'package.json'))).toBe(true);
      expect(existsSync(path.join(pluginDir, 'node_modules', 'tough-cookie'))).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(expect.any(String), 'warning insomnia-plugin-request@3.6.0: Package no longer supported. Use at your own risk.');
    });

    it('should install a plugin when yarn prints peer dependency and node warnings', async () => {
      add.stderr = ADD_PEER_STDERR + NODE_WARNING_STDERR;
      await expect(installPlugin('insomnia-plugin-request')).resolves.toBeUndefined();
    });

    it('should install a plugin when yarn info prints a warning', async () => {
      info.stderr = INFO_LICENSE_STDERR;
      await expect(installPlugin('insomnia-plugin-request')).resolves.toBeUndefined();
    });

    it('should report a package that does not exist', async () => {
      info = { exitCode: 0, stdout: '', stderr: INFO_NOT_FOUND_STDERR };
      await expect(installPlugin('insomnia-plugin-does-not-exist-zzz')).rejects.toThrow('Received invalid response from npm.');
    });

    it('should report a version that does not exist', async () => {
      add = { exitCode: 1, stdout: ADD_BAD_VERSION_STDOUT, stderr: ADD_BAD_VERSION_STDERR };
      await expect(installPlugin('insomnia-plugin-request@99.0.0')).rejects.toThrow('Couldn\'t find any versions for "insomnia-plugin-request"');
    });

    it('should report a yarn error even when yarn exits successfully', async () => {
      add.stderr = ADD_DEPRECATED_STDERR + ADD_NOT_FOUND_STDERR;
      await expect(installPlugin('insomnia-plugin-request')).rejects.toThrow('Yarn error');
    });

    it('should install a plugin when electron exits non-zero after yarn succeeded', async () => {
      add = { exitCode: 1, stdout: ADD_DEPRECATED_STDOUT, stderr: ADD_DEPRECATED_STDERR };
      await expect(installPlugin('insomnia-plugin-request')).resolves.toBeUndefined();
    });
  });
});
