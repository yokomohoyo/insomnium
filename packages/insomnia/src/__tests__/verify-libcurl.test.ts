import { describe, expect, it } from '@jest/globals';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { LIBCURL_BINARIES, LIBCURL_VERSION, libcurlBinaryProblem } from '../../scripts/verify-libcurl';

const installed = (version: string, binary: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libcurl-'));
  fs.mkdirSync(path.join(dir, 'lib', 'binding'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(dir, 'lib', 'binding', 'node_libcurl.node'), binary);
  return dir;
};
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

describe('libcurlBinaryProblem()', () => {
  const pins = { 'linux-x64': sha256('the release build') };

  it('passes the pinned binary, and nothing else', () => {
    expect(libcurlBinaryProblem(installed('1.0.0', 'the release build'), 'linux-x64', pins, '1.0.0')).toBeNull();
    expect(libcurlBinaryProblem(installed('1.0.0', 'something else'), 'linux-x64', pins, '1.0.0')).toMatch(/^node_libcurl.node for linux-x64 has SHA-256 [0-9a-f]{64}, not/);
    expect(libcurlBinaryProblem(installed('1.0.0', 'the release build'), 'linux-arm64', pins, '1.0.0')).toBe('no sum for linux-arm64');
    expect(libcurlBinaryProblem(installed('1.0.1', 'the release build'), 'linux-x64', pins, '1.0.0')).toBe('node-libcurl 1.0.1 is installed, and the sums are for 1.0.0');
  });

  it('pins the version the app depends on, for each release build', () => {
    const dependency = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).dependencies['@getinsomnia/node-libcurl'];
    expect(dependency).toContain(`/v${LIBCURL_VERSION}/`);
    expect(Object.keys(LIBCURL_BINARIES)).toEqual(expect.arrayContaining(['darwin-arm64', 'linux-x64', 'win32-x64']));
  });
});
