import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';

import * as electron from 'electron';
import { app } from 'electron';
import path from 'path';

import { isDevelopment } from '../common/constants';
import type { Settings } from '../models/settings';
import { describeProxy, proxyFor } from './network/proxy';
import { assertValidPackageSpec } from './validate-package-spec';

interface InsomniaPlugin {
  // Insomnium attribute from package.json
  insomnia: {
    name: string;
    displayName: string;
    description: string;

    // Used by the plugin hub, not currently used by Insomnium
    // Each image is relative to package root
    images?: {
      icon?: string;
      cover?: string;
    };

    unlisted?: boolean;

    publisher?: {
      name: string;
      // absolute URL
      icon: string;
    };
  };

  // NPM specific properties
  name: string;
  version: string;
  dist: {
    shasum: string;
    tarball: string;
  };
}

// Where installs come from: the npm registry, or another set in Preferences (a
// mirror, or a company's own), through the proxy requests go through
export interface PluginInstallOptions {
  registry?: string;
  proxy?: string;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

type InstallSettings = Pick<Settings, 'pluginRegistry' | 'proxyEnabled' | 'httpProxy' | 'httpsProxy' | 'noProxy' | 'useSystemProxy'>;

const isWebAddress = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export async function pluginInstallOptions(settings: InstallSettings, env?: Record<string, string | undefined>): Promise<PluginInstallOptions> {
  const registry = (settings.pluginRegistry || '').trim().replace(/\/+$/, '');
  if (registry && !isWebAddress(registry)) {
    throw new Error(`The plugin registry has to be an http:// or https:// address, not ${JSON.stringify(registry)}`);
  }
  const proxy = await proxyFor(registry || DEFAULT_REGISTRY, settings, env);
  const usable = proxy && /^https?:/i.test(proxy) ? proxy : null;
  if (proxy && !usable) {
    console.warn(`[plugins] Installing directly: yarn can only go through an HTTP proxy, not ${describeProxy(proxy)}`);
  }
  return {
    ...(registry ? { registry } : {}),
    ...(usable ? { proxy: usable } : {}),
  };
}

// yarn's flags for them
export const yarnNetworkArgs = ({ registry, proxy }: PluginInstallOptions) => [
  ...(registry ? ['--registry', registry] : []),
  ...(proxy ? ['--proxy', proxy, '--https-proxy', proxy] : []),
];

const pluginsDir = () => path.join(process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData'), 'plugins');

export default async function installPlugin(lookupName: string, options: PluginInstallOptions = {}) {
  assertValidPackageSpec(lookupName);
  const info = await _isInsomniaPlugin(lookupName, options);
  const { tmpDir } = await _installPluginToTmpDir(lookupName, options);
  // the actual module name, without a version
  await _movePlugin(tmpDir, info.name);
  return info.name as string;
}

// A plugin from a package tarball on this computer (npm pack's .tgz), to
// install without the registry. Its dependencies still come from the
// registry, unless it bundles them.
export async function installPluginFromFile(file: string, options: PluginInstallOptions = {}) {
  const tarball = path.resolve(file);
  if (!/\.(tgz|tar\.gz)$/i.test(tarball) || !(await stat(tarball)).isFile()) {
    throw new Error(`${path.basename(tarball)} isn't a package tarball (.tgz)`);
  }
  const { tmpDir } = await _installPluginToTmpDir(`file:${tarball}`, options, path.basename(tarball));
  const manifest = JSON.parse(await readFile(path.join(tmpDir, 'package.json'), 'utf8'));
  const [moduleName] = Object.keys(manifest.dependencies || {});
  const pluginJson = moduleName ? JSON.parse(await readFile(path.join(tmpDir, moduleName, 'package.json'), 'utf8')) : null;
  if (!pluginJson?.hasOwnProperty('insomnia')) {
    throw new Error(`${path.basename(tarball)} isn't a plugin: its package.json has no "insomnia" key`);
  }
  await _movePlugin(tmpDir, moduleName);
  return moduleName as string;
}

async function _movePlugin(tmpDir: string, moduleName: string) {
  const pluginDir = path.join(pluginsDir(), moduleName);
  await mkdir(pluginDir, { recursive: true });
  console.log(`[plugins] Moving plugin from ${tmpDir} to ${pluginDir}`);

  // Move entire module to plugins folder
  await cp(path.join(tmpDir, moduleName), pluginDir, { recursive: true, verbatimSymlinks: true });

  // Move each dependency into node_modules folder
  const pluginModulesDir = path.join(pluginDir, 'node_modules');
  await mkdir(pluginModulesDir, { recursive: true });

  for (const filename of await readdir(tmpDir)) {
    const src = path.join(tmpDir, filename);
    const file = await stat(src);
    if (filename === moduleName || !file.isDirectory()) {
      continue;
    }

    const dest = path.join(pluginModulesDir, filename);
    await cp(src, dest, { recursive: true, verbatimSymlinks: true });
  }
}

// Yarn runs in a utility process, a Node.js child of the app (rather than the
// app run as Node with ELECTRON_RUN_AS_NODE, which the release build's fuses
// turn off). The callback gets an error for a non-zero exit, and the output.
export const yarnProcess = {
  run(args: string[], { timeout, cwd, env }: { timeout: number; cwd?: string; env: Record<string, string> }, callback: (err: (Error & { code?: number }) | null, stdout: string, stderr: string) => void) {
    const child = electron.utilityProcess.fork(_getYarnPath(), args, {
      // Because Yarn still uses `new Buffer()`
      execArgv: ['--no-deprecation'],
      cwd,
      env,
      stdio: 'pipe',
      serviceName: 'Insomnium plugin install',
    });
    let stdout = '';
    let stderr = '';
    const read = (stream: NodeJS.ReadableStream | null, append: (chunk: string) => void) => new Promise<void>(resolve => {
      if (!stream) {
        return resolve();
      }
      stream.on('data', chunk => append(String(chunk)));
      stream.on('end', resolve);
      stream.on('error', () => resolve());
    });
    const output = Promise.all([read(child.stdout, chunk => {
      stdout += chunk;
    }), read(child.stderr, chunk => {
      stderr += chunk;
    })]);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.once('exit', async code => {
      clearTimeout(timer);
      await output;
      const err = timedOut ? new Error(`Yarn took longer than ${timeout / 1000} s`) : code ? Object.assign(new Error(`Command failed with exit code ${code}
${stderr}`), { code }) : null;
      callback(err, stdout, stderr);
    });
  },
};

async function _isInsomniaPlugin(lookupName: string, options: PluginInstallOptions) {
  return new Promise<InsomniaPlugin>((resolve, reject) => {
    console.log('[plugins] Fetching module info from npm');
    // shell:false (default) - args are passed verbatim to the child, so
    // shell metacharacters in lookupName cannot be interpreted as code.
    yarnProcess.run(
      [
        'info',
        lookupName,
        '--json',
        ...yarnNetworkArgs(options),
      ],
      {
        timeout: 5 * 60 * 1000,
        env: {
          NODE_ENV: 'production',
        },
      },
      (err, stdout, stderr) => {
        // Yarn exits 0 for an unknown package, reporting it only on stderr
        if (stderr && containsYarnErrors(stderr.toString())) {
          reject(new Error(`Yarn error ${stderr.toString()}`));
          return;
        }

        let yarnOutput;

        try {
          yarnOutput = JSON.parse(stdout.toString());
        } catch (ex) {
          // Output is not JSON. Check if yarn/electron terminated with non-zero exit code.
          // In certain environments electron can exit with error even if output is OK.
          // Parsing is attempted before checking exit code as workaround for false errors.
          if (err) {
            reject(new Error(`${lookupName} npm error: ${err.message}`));
          } else {
            reject(new Error(`Yarn response not JSON: ${ex.message}`));
          }

          return;
        }

        const data = yarnOutput.data;
        console.log('[plugin data]', data);

        if (!data.hasOwnProperty('insomnia')) {
          reject(new Error(`"${lookupName}" not a plugin! Package missing "insomnia" attribute in object :${JSON.stringify(data)}`));
          return;
        }

        console.log(`[plugins] Detected Insomnium plugin ${data.name}`);
        const insomniaPlugin: InsomniaPlugin = {
          insomnia: data.insomnia,
          name: data.name,
          version: data.version,
          dist: {
            shasum: data.dist.shasum,
            tarball: data.dist.tarball,
          },
        };
        resolve(insomniaPlugin);
      },
    );
  });
}

async function _installPluginToTmpDir(lookupName: string, options: PluginInstallOptions, label = lookupName) {
  return new Promise<{ tmpDir: string }>(async (resolve, reject) => {
    // mkdtemp: atomic, unguessable name - avoids tmp symlink races.
    const safeName = label.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const tmpDir = await mkdtemp(path.join(electron.app.getPath('temp'), `${safeName}-`));
    // Write a dummy package.json so that yarn doesn't traverse up the directory tree
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ license: 'ISC', workspaces: [] }), 'utf-8');

    console.log(`[plugins] Installing plugin to ${tmpDir}`);
    // shell:false (default) - args are passed verbatim to the child, so
    // shell metacharacters in lookupName cannot be interpreted as code.
    yarnProcess.run(
      [
        'add',
        lookupName,
        '--modules-folder',
        tmpDir,
        '--cwd',
        tmpDir,
        '--no-lockfile',
        '--production',
        '--no-progress',
        '--ignore-workspace-root-check',
        // a package's install scripts would run here, with Node and as the user,
        // before the plugin is anywhere near its sandbox
        '--ignore-scripts',
        ...yarnNetworkArgs(options),
      ],
      {
        timeout: 5 * 60 * 1000,
        cwd: tmpDir,
        env: {
          NODE_ENV: 'production',
        },
      },
      (err, stdout, stderr) => {
        console.log('[plugins] Install complete', { err, stdout, stderr });
        // Check yarn/electron process exit code.
        // In certain environments electron can exit with error even if the command was performed successfully.
        // Checking for success message in output is a workaround for false errors.
        if (err && !stdout.toString().includes('success')) {
          reject(new Error(`${lookupName} install error: ${err.message}`));
          return;
        }

        if (stderr && containsYarnErrors(stderr.toString())) {
          reject(new Error(`Yarn error ${stderr.toString()}`));
          return;
        }

        resolve({
          tmpDir,
        });
      },
    );
  });
}

/**
 * Yarn also writes warnings to stderr (deprecated dependencies, missing license
 * field, peer dependencies, node warnings), so stderr output alone does not mean
 * the command failed. Returns true only if yarn reported an error: an
 * `error ...` line, or with --json a `{"type":"error",...}` line. Lines before
 * the first error are logged so warnings aren't hidden; lines after it are
 * usually the rest of a multi-line error (e.g. "Exit code: ...") and end up in
 * the rejection message along with the rest of stderr.
 */
export function containsYarnErrors(stderr: string) {
  for (const line of stderr.split(/\r?\n/).filter(line => line)) {
    if (isYarnError(line)) {
      return true;
    }
    console.warn('[plugins] yarn warning: ', line);
  }
  return false;
}

function isYarnError(line: string) {
  if (line.startsWith('error ')) {
    return true;
  }

  try {
    return JSON.parse(line)?.type === 'error';
  } catch {
    return false;
  }
}

function _getYarnPath() {
  // TODO: This is brittle. Make finding this more robust.
  if (isDevelopment()) {
    return path.resolve(app.getAppPath(), './bin/yarn-standalone.js');
  } else {
    return path.resolve(app.getAppPath(), '../bin/yarn-standalone.js');
  }
}
