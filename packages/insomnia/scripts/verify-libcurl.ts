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
// for Electron 45.0, by process.platform-process.arch
export const LIBCURL_BINARIES: Record<string, string> = {
  'darwin-arm64': 'a6306fe6d710bd63333aa91764659e946e50930adc543a0228f88282b5899b28',
  'darwin-x64': 'c01f11920c8a25aea49d67bef06c4c03db84fbaab9cfb9d4bf7b6f1159fad5bd',
  'linux-x64': '272fcbe42576a528c7979dfeacb716bdfd4257ce4440cae724332c4f0813d08d',
  'win32-x64': '24adb42d49b9444e590e0b80b6e34fd80b99efe406b21829d1bed39f638f8260',
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
