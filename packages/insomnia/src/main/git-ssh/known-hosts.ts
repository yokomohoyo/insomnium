// Checking an SSH host's key against known_hosts files, as ssh does: by name
// ([host]:port off port 22), plain or hashed (|1|salt|hash), with wildcards.
// A host listed with another key of the same type has changed key, which is
// refused; one not listed (or listed only with other types) is up to the user.
import crypto from 'crypto';

import { hostMatches } from './ssh-config';

export type HostKeyCheck =
  | { status: 'known' }
  | { status: 'unknown'; otherTypesKnown: boolean }
  | { status: 'changed'; file: string; line: number }
  | { status: 'revoked'; file: string; line: number };

export interface KnownHostsFile {
  path: string;
  text: string;
}

export const hostEntryName = (host: string, port: number) => (port === 22 ? host : `[${host}]:${port}`);

// the key's algorithm, the first string in its wire form
export function keyType(key: Buffer) {
  const length = key.readUInt32BE(0);
  return key.subarray(4, 4 + length).toString('ascii');
}

// as ssh shows it: SHA256:<base64, unpadded>
export const fingerprint = (key: Buffer) => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

export const knownHostsLine = (host: string, port: number, key: Buffer) => `${hostEntryName(host, port)} ${keyType(key)} ${key.toString('base64')}`;

const hashedMatches = (entry: string, name: string) => {
  const [, , salt, hash] = entry.split('|');
  return !!salt && !!hash && crypto.createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest('base64') === hash;
};

const namesMatch = (hosts: string, name: string) => {
  const patterns = hosts.split(',');
  const hashed = patterns.filter(pattern => pattern.startsWith('|1|'));
  return hashed.length ? hashed.some(pattern => hashedMatches(pattern, name)) : hostMatches(patterns, name);
};

export function checkHostKey(files: KnownHostsFile[], host: string, port: number, key: Buffer): HostKeyCheck {
  const name = hostEntryName(host, port);
  const type = keyType(key);
  const encoded = key.toString('base64');
  let known = false;
  let otherTypesKnown = false;
  let changed: { file: string; line: number } | null = null;
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const fields = lines[index].trim().split(/\s+/);
      if (!fields[0] || fields[0].startsWith('#')) {
        continue;
      }
      const marker = fields[0].startsWith('@') ? fields.shift() : undefined;
      const [hosts, entryType, entryKey] = fields;
      if (!hosts || !entryType || !entryKey || !namesMatch(hosts, name)) {
        continue;
      }
      if (marker === '@revoked') {
        if (entryKey === encoded) {
          return { status: 'revoked', file: file.path, line: index + 1 };
        }
      } else if (marker) {
        // @cert-authority: host certificates aren't taken
      } else if (entryType !== type) {
        otherTypesKnown = true;
      } else if (entryKey === encoded) {
        known = true;
      } else {
        changed = changed || { file: file.path, line: index + 1 };
      }
    }
  }
  if (known) {
    return { status: 'known' };
  }
  return changed ? { status: 'changed', ...changed } : { status: 'unknown', otherTypesKnown };
}
