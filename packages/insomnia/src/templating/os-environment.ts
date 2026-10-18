import { parse } from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Settings } from '../common/settings';
import { guard } from '../utils/guard';

// The OS environment variables {% env %} may read: none unless the user names
// them, since a collection from someone else could otherwise send any of them
// anywhere. Entries are names, or prefixes ending in * (a lone * is any).
export const allowedNames = (setting: string) => setting.split(/[\s,]+/).filter(Boolean);

export const isAllowed = (name: string, allowed: string[]) =>
  allowed.some(entry => entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : name === entry);

const expandHome = (file: string) => file === '~' || file.startsWith('~/') ? path.join(os.homedir(), file.slice(1)) : file;

// The OS environment first, then the dotenv file, as dotenv does: so CI can
// override what the file says. The file is read each time, to pick up edits.
export async function readEnvironmentVariable(
  name: string,
  { allowedEnvironmentVariables, dotenvFile }: Pick<Settings, 'allowedEnvironmentVariables' | 'dotenvFile'>,
  env: Record<string, string | undefined> = process.env,
) {
  guard(/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name), `"${name}" isn't an environment variable name`);
  guard(
    isAllowed(name, allowedNames(allowedEnvironmentVariables || '')),
    `${name} isn't an allowed environment variable: add it in Preferences > General > OS Environment Variables`,
  );
  if (env[name] !== undefined) {
    return env[name] as string;
  }
  if (dotenvFile) {
    const file = expandHome(dotenvFile.trim());
    guard(path.isAbsolute(file), `The dotenv file must be a full path, not "${dotenvFile}"`);
    const values = parse(await fs.promises.readFile(file, 'utf8'));
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name];
    }
  }
  throw new Error(`${name} isn't set in the environment${dotenvFile ? ` or ${dotenvFile}` : ''}`);
}
