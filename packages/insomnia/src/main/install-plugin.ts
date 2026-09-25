import { cp, mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';

import childProcess from 'child_process';
import * as electron from 'electron';
import { app } from 'electron';
import path from 'path';

import { isDevelopment } from '../common/constants';
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

export default async function(lookupName: string) {
  return new Promise<void>(async (resolve, reject) => {
    let info: InsomniaPlugin | null = null;

    try {
      assertValidPackageSpec(lookupName);
      info = await _isInsomniaPlugin(lookupName);
      // Get actual module name without version suffixes and things
      const moduleName = info.name;
      const pluginDir = path.join(process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData'), 'plugins', moduleName);

      // Make plugin directory
      await mkdir(pluginDir, { recursive: true });

      // Download the module
      const request = electron.net.request(info.dist.tarball);
      request.on('error', err => {
        reject(new Error(`Failed to make plugin request ${info?.dist.tarball}: ${err.message}`));
      });

      const { tmpDir } = await _installPluginToTmpDir(lookupName);
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
    } catch (err) {
      reject(err);
      return;
    }

    resolve();
  });
}

async function _isInsomniaPlugin(lookupName: string) {
  return new Promise<InsomniaPlugin>((resolve, reject) => {
    console.log('[plugins] Fetching module info from npm');
    // shell:false (default) - args are passed verbatim to the child, so
    // shell metacharacters in lookupName cannot be interpreted as code.
    childProcess.execFile(
      process.execPath,
      [
        '--no-deprecation', // Because Yarn still uses `new Buffer()`
        _getYarnPath(),
        'info',
        lookupName,
        '--json',
      ],
      {
        timeout: 5 * 60 * 1000,
        maxBuffer: 1024 * 1024,
        env: {
          NODE_ENV: 'production',
          ELECTRON_RUN_AS_NODE: 'true',
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

async function _installPluginToTmpDir(lookupName: string) {
  return new Promise<{ tmpDir: string }>(async (resolve, reject) => {
    // mkdtemp: atomic, unguessable name - avoids tmp symlink races.
    const safeName = lookupName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const tmpDir = await mkdtemp(path.join(electron.app.getPath('temp'), `${safeName}-`));
    // Write a dummy package.json so that yarn doesn't traverse up the directory tree
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ license: 'ISC', workspaces: [] }), 'utf-8');

    console.log(`[plugins] Installing plugin to ${tmpDir}`);
    // shell:false (default) - args are passed verbatim to the child, so
    // shell metacharacters in lookupName cannot be interpreted as code.
    childProcess.execFile(
      process.execPath,
      [
        '--no-deprecation', // Because Yarn still uses `new Buffer()`
        _getYarnPath(),
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
      ],
      {
        timeout: 5 * 60 * 1000,
        maxBuffer: 1024 * 1024,
        cwd: tmpDir,
        env: {
          NODE_ENV: 'production',
          ELECTRON_RUN_AS_NODE: 'true',
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
