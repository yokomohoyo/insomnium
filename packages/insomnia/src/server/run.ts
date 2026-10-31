import fs from 'node:fs';

import * as models from '../models';
import type { RequestGroup } from '../models/request-group';
import type { Workspace } from '../models/workspace';
import { parseDataFile } from '../network/run-files';
import { listRunnableRequests, RunnableRequest } from '../network/runner';
import { emptySources, GIT_USAGE, requireSources, Sources, SOURCES_USAGE, takeSourceOption } from './sources';

// `insomnium-server run`: the collection runner for CI. It sends the requests
// in order, checks their assertions, and exits 1 when any fails.

export interface RunConfig extends Sources {
  environment?: string;
  folder?: string;
  iterations?: number;
  data?: string;
  delay: number;
  bail: boolean;
  junit?: string;
  json?: string;
  html?: string;
  csv?: string;
  // an earlier run's JSON report, and the share of its p95 a request may grow by
  baseline?: string;
  maxSlowdown?: number;
  allowedHosts: string[];
  variables: Record<string, string>;
  validateSSL: boolean;
  allowedEnvironmentVariables: string;
  allowedSecrets: string;
}

export const RUN_USAGE = `Usage: insomnium-server run (--collection <file> | --repo <url or directory>) [--folder <name>] [--env <name>] [options]

Sends the collection's HTTP requests in order, as Send does, and checks their
assertions. Exits 1 when a request can't be sent or an assertion fails.

${SOURCES_USAGE}
  --folder      only the requests in this folder: its name, or a path like "Users/Admin"
  --env         the sub environment to send with, by name
  --iterations  how many times to run them (default 1, or once per data row)
  --data        a CSV or JSON file with one row of variables per iteration
  --delay       milliseconds to wait between requests
  --bail        stop at the first request that fails
  --junit       write a JUnit XML report to this file
  --json        write a JSON report to this file
  --html        write an HTML report to this file: each request's latency and phases
  --csv         write a CSV report to this file: a row per request sent
  --baseline    compare with an earlier run's JSON report (--json): exits 1 when a
                request's p95 got slower than --max-slowdown allows
  --max-slowdown  the percentage a request's p95 may grow by over the baseline's (default 20);
                changes of 5 ms or less don't count

Environment:
  INSOMNIUM_ALLOWED_HOSTS  comma-separated hosts requests may go to; any by default,
                           except cloud metadata hosts, which must be listed
  INSOMNIUM_VAR_<name>     sets <name> in the environment, for secrets
  INSOMNIUM_VALIDATE_SSL   false to skip certificate validation
  INSOMNIUM_ALLOWED_ENV    environment variables templates may read with {% env 'NAME' %}:
                           comma-separated names, or prefixes ending in *; none by default
  INSOMNIUM_ALLOWED_SECRETS secret-manager secrets templates may read (vault:<path>, op://…,
                           aws:<id>, gcp:projects/…, azure:<vault>/<name>), or prefixes
                           ending in *; none by default
${GIT_USAGE}`;

const VAR_PREFIX = 'INSOMNIUM_VAR_';

const wholeNumber = (option: string, value: string, min: number) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${option} must be a whole number of at least ${min}`);
  }
  return number;
};

// what sends may do, from the environment: run's and load's
export const sendingEnvironment = (env: Record<string, string | undefined>) => {
  const allowedHosts = (env.INSOMNIUM_ALLOWED_HOSTS || '*').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return {
    allowedHosts: allowedHosts.length ? allowedHosts : ['*'],
    variables: Object.fromEntries(Object.entries(env)
      .filter((entry): entry is [string, string] => entry[0].startsWith(VAR_PREFIX) && entry[0].length > VAR_PREFIX.length && entry[1] !== undefined)
      .map(([name, value]) => [name.slice(VAR_PREFIX.length), value])),
    validateSSL: env.INSOMNIUM_VALIDATE_SSL !== 'false',
    allowedEnvironmentVariables: env.INSOMNIUM_ALLOWED_ENV || '',
    allowedSecrets: env.INSOMNIUM_ALLOWED_SECRETS || '',
  };
};

export const parseRunConfig = (argv: string[], env: Record<string, string | undefined>): RunConfig => {
  const config: RunConfig = {
    ...emptySources(env),
    delay: 0,
    bail: false,
    ...sendingEnvironment(env),
  };

  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${option} needs a value`);
      }
      return next;
    };
    if (takeSourceOption(config, option, value)) {
      continue;
    }
    switch (option) {
      case '--env':
        config.environment = value();
        break;
      case '--folder':
        config.folder = value();
        break;
      case '--iterations':
        config.iterations = wholeNumber(option, value(), 1);
        break;
      case '--data':
        config.data = value();
        break;
      case '--delay':
        config.delay = wholeNumber(option, value(), 0);
        break;
      case '--bail':
        config.bail = true;
        break;
      case '--junit':
        config.junit = value();
        break;
      case '--json':
        config.json = value();
        break;
      case '--html':
        config.html = value();
        break;
      case '--csv':
        config.csv = value();
        break;
      case '--baseline':
        config.baseline = value();
        break;
      case '--max-slowdown': {
        const percent = Number(value());
        if (!Number.isFinite(percent) || percent < 0) {
          throw new Error(`${option} must be a percentage, such as 20`);
        }
        config.maxSlowdown = percent / 100;
        break;
      }
      default:
        throw new Error(`Unknown option ${option}`);
    }
  }

  requireSources(config);
  return config;
};

export const readDataFile = async (file: string) => parseDataFile(file, await fs.promises.readFile(file, 'utf8'));

interface Folder {
  folder: RequestGroup;
  path: string[];
}

const listFolders = async (parentId: string, path: string[] = []): Promise<Folder[]> => {
  const folders: Folder[] = [];
  for (const folder of await models.requestGroup.findByParentId(parentId)) {
    const folderPath = [...path, folder.name];
    folders.push({ folder, path: folderPath }, ...await listFolders(folder._id, folderPath));
  }
  return folders;
};

// The requests to run: all of them, or one folder's, found by name or path
export async function selectRequests(workspaces: Workspace[], folder?: string): Promise<RunnableRequest[]> {
  if (!folder) {
    const all: RunnableRequest[] = [];
    for (const workspace of workspaces) {
      all.push(...await listRunnableRequests(workspace._id));
    }
    return all;
  }
  const folders: Folder[] = [];
  for (const workspace of workspaces) {
    folders.push(...await listFolders(workspace._id));
  }
  const wanted = folder.split('/').map(part => part.trim()).filter(Boolean).join('/');
  const found = folders.filter(({ path }) => path.join('/') === wanted);
  const matches = found.length ? found : folders.filter(({ path }) => path[path.length - 1] === wanted);
  if (!matches.length) {
    throw new Error(`No folder '${folder}'. The collections have: ${folders.map(({ path }) => path.join('/')).join(', ') || 'no folders'}`);
  }
  if (matches.length > 1) {
    throw new Error(`'${folder}' names ${matches.length} folders: ${matches.map(({ path }) => path.join('/')).join(', ')}. Give its path.`);
  }
  return listRunnableRequests(matches[0].folder._id, matches[0].path);
}
