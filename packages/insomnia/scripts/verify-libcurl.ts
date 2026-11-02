// Checks node-libcurl's prebuilt binary, which its install script downloads
// from a GitHub release (the lockfile pins only the package around it),
// against the SHA-256 each release build's has.
//
//   npm run verify:libcurl --workspace=packages/insomnia
//
// After moving node-libcurl or the Electron target (.npmrc), take the new
// sums from the fork's release: sha256sum of binding/node_libcurl.node in each
// node_libcurl-v<version>-electron-v<target>-<platform>-<arch>-<libc>.tar.gz.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const LIBCURL_VERSION = '5.1.2-insomnium.3';
// for Electron 43.2, by process.platform-process.arch
export const LIBCURL_BINARIES: Record<string, string> = {
  'darwin-arm64': 'a68fa1023aa587dda5c5415513521b9520d53f6e51484cb5f1a65d36d8b432ca',
  'darwin-x64': 'eefb04fb48ea62687f94fd3a8916d42e742d3c57afa4715b5fefb921f2d8095b',
  'linux-x64': '97fa753e96c77655549813e1c3b48a2f2905e1aab1ead60e0b3827679c43ed17',
  'win32-x64': 'f83503c74f33891fac17c0173bc463e0dd7192910968a8e6fd5490f0ea2d8666',
};

export const LIBCURL_DIR = path.join(__dirname, '..', 'node_modules', '@getinsomnia', 'node-libcurl');

// what's wrong with the binary installed in dir, or null if it's the one pinned
export function libcurlBinaryProblem(dir: string, target: string, binaries = LIBCURL_BINARIES, version = LIBCURL_VERSION) {
  const installed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  if (installed !== version) {
    return `node-libcurl ${installed} is installed, and the sums are for ${version}`;
  }
  const expected = binaries[target];
  if (!expected) {
    return `no sum for ${target}`;
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'lib', 'binding', 'node_libcurl.node'))).digest('hex');
  return actual === expected ? null : `node_libcurl.node for ${target} has SHA-256 ${actual}, not ${expected}`;
}

if (require.main === module) {
  const problem = libcurlBinaryProblem(LIBCURL_DIR, `${process.platform}-${process.arch}`);
  if (problem) {
    console.error(`[verify-libcurl] ${problem}`);
    process.exit(1);
  }
  console.log('[verify-libcurl] node_libcurl.node is the one pinned');
}
