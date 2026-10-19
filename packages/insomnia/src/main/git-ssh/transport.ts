// Git over SSH, for isomorphic-git, which speaks only git's smart HTTP
// protocol: each of its requests of an SSH remote (sync/git/ssh-url.ts) is run
// as git's ssh transport does, over ssh2. GET info/refs runs the service and
// returns its ref advertisement, in the form HTTP gives it; POST runs it again,
// passes over the advertisement, sends the request, and returns what comes back.
import fs from 'fs';
import path from 'path';
import { type AuthMethod, Client, type ClientChannel, type ParsedKey, utils } from 'ssh2';

import { type GitService, parseSshUrl, SSH_KEY_HEADER, SSH_PASSPHRASE_HEADER, sshRequestOf } from '../../sync/git/ssh-url';
import { checkHostKey, fingerprint, hostEntryName, keyType, knownHostsLine } from './known-hosts';
import { hostConfig } from './ssh-config';

export interface GitSshRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

export interface GitSshResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface HostToTrust {
  host: string;
  keyType: string;
  fingerprint: string;
  // the host is known with keys of other types, though not this one
  otherTypesKnown: boolean;
}

export interface SshEnvironment {
  // where ~/.ssh is
  home: string;
  // agents to try first: a socket, a Windows pipe, or 'pageant'
  agents: string[];
  // where a host the user trusts is added
  appKnownHostsFile: string;
  askToTrust: (host: HostToTrust) => Promise<boolean>;
}

const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'];

// ~/.ssh's files are small and read once a request, as ssh itself reads them
const readText = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const expandHome = (file: string, home: string) => file.replace(/^~(?=$|[\\/])/, home);

const pktLine = (text: string) => `${(text.length + 4).toString(16).padStart(4, '0')}${text}`;

// where a run of pkt-lines ends: just after its flush-pkt (0000), or -1 before it has
export function flushEnd(data: Buffer) {
  let offset = 0;
  while (offset + 4 <= data.length) {
    const length = parseInt(data.subarray(offset, offset + 4).toString('ascii'), 16);
    if (Number.isNaN(length)) {
      throw new Error('The remote answered with something other than git');
    }
    if (length === 0) {
      return offset + 4;
    }
    if (length < 4) {
      // delim-pkt and response-end of protocol v2, not asked for: a line of their own
      offset += 4;
      continue;
    }
    offset += length;
  }
  return -1;
}

// a path as the remote's shell takes it, as git quotes it
const quoted = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

interface KeyFile {
  file: string;
  key: ParsedKey;
}

function loadKeys(files: string[], passphrases: Record<string, string>) {
  const keys: KeyFile[] = [];
  const locked: string[] = [];
  for (const file of [...new Set(files)]) {
    const text = readText(file);
    if (!text) {
      continue;
    }
    const parsed = utils.parseKey(text, passphrases[file] || undefined);
    if (parsed instanceof Error) {
      if (/passphrase|encrypted/i.test(parsed.message)) {
        locked.push(file);
      }
      continue;
    }
    keys.push({ file, key: Array.isArray(parsed) ? parsed[0] : parsed });
  }
  return { keys, locked };
}

/**
 * Runs one of isomorphic-git's requests of an SSH remote. Keys come from the
 * agents, then a key file the repository names (with its passphrase), then
 * ~/.ssh/config's IdentityFile for the host, then ~/.ssh/id_*. The host's key
 * must be in ~/.ssh/known_hosts or the app's own list, or be trusted when asked.
 */
export async function gitSshRequest(request: GitSshRequest, env: SshEnvironment): Promise<GitSshResponse> {
  const target = sshRequestOf(request.url);
  const address = target && parseSshUrl(target.sshUrl);
  if (!target || !address) {
    throw new Error(`Not an SSH remote: ${request.url}`);
  }
  const sshDir = path.join(env.home, '.ssh');
  const config = hostConfig(readText(path.join(sshDir, 'config')) || '', address.host, env.home);
  const host = config.hostName || address.host;
  const user = address.user || config.user || 'git';
  const port = address.port || config.port || 22;

  const headers = Object.fromEntries(Object.entries(request.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
  const repositoryKey = headers[SSH_KEY_HEADER] ? expandHome(headers[SSH_KEY_HEADER], env.home) : '';
  const { keys, locked } = loadKeys(
    [...(repositoryKey ? [repositoryKey] : []), ...config.identityFiles, ...DEFAULT_KEYS.map(name => path.join(sshDir, name))],
    repositoryKey ? { [repositoryKey]: headers[SSH_PASSPHRASE_HEADER] || '' } : {},
  );
  const authHandler: AuthMethod[] = [
    ...env.agents.map(agent => ({ type: 'agent' as const, username: user, agent })),
    ...keys.map(({ key }) => ({ type: 'publickey' as const, username: user, key })),
  ];

  let hostError: Error | null = null;
  const verifyHost = async (key: Buffer) => {
    const files = [path.join(sshDir, 'known_hosts'), path.join(sshDir, 'known_hosts2'), env.appKnownHostsFile];
    const knownHosts = files.map(file => ({ path: file, text: readText(file) || '' }));
    const check = checkHostKey(knownHosts, host, port, key);
    const name = hostEntryName(host, port);
    if (check.status === 'known') {
      return true;
    }
    if (check.status === 'revoked') {
      throw new Error(`The host key of ${name} is revoked (${check.file}, line ${check.line}), so Insomnium won't connect to it.`);
    }
    if (check.status === 'changed') {
      throw new Error(`The host key of ${name} isn't the one trusted for it (${check.file}, line ${check.line}). Someone may be in between. If the host has changed its key, delete that line and connect again to trust the new one.`);
    }
    const trusted = await env.askToTrust({ host: name, keyType: keyType(key), fingerprint: fingerprint(key), otherTypesKnown: check.otherTypesKnown });
    if (!trusted) {
      throw new Error(`Not connected: the host key of ${name} wasn't trusted.`);
    }
    await fs.promises.mkdir(path.dirname(env.appKnownHostsFile), { recursive: true });
    await fs.promises.appendFile(env.appKnownHostsFile, `${knownHostsLine(host, port, key)}\n`);
    return true;
  };

  const client = new Client();
  try {
    await new Promise<void>((resolve, reject) => {
      client.on('ready', resolve);
      client.on('error', err => {
        // an agent that isn't running: the next way of signing in is tried
        if (err.level === 'agent') {
          return;
        }
        if (hostError) {
          return reject(hostError);
        }
        if (/authentication methods failed/i.test(err.message)) {
          const tried = [...(env.agents.length ? ['the SSH agent'] : []), ...keys.map(({ file }) => file)];
          const lockedNote = locked.length ? ` ${locked.join(', ')} ${locked.length === 1 ? 'needs its' : 'need their'} passphrase: set it in the repository's settings, or add the key to the SSH agent.` : '';
          return reject(new Error(`${user}@${host} didn't accept ${tried.length ? `the keys tried (${tried.join(', ')})` : 'a key: none was found in the SSH agent or ~/.ssh'}.${lockedNote}`));
        }
        reject(new Error(`Couldn't connect to ${host}:${port} over SSH: ${err.message}`));
      });
      client.connect({
        host,
        port,
        username: user,
        readyTimeout: 30_000,
        keepaliveInterval: 15_000,
        authHandler,
        hostVerifier: (key, verify) => {
          verifyHost(key).then(verify, err => {
            hostError = err;
            verify(false);
          });
        },
      });
    });
    return await run(client, target.service, address.path, target.advertisement ? undefined : Buffer.from(request.body || []));
  } finally {
    client.end();
  }
}

// runs the service: without a body, its advertisement is all that's wanted
async function run(client: Client, service: GitService, repoPath: string, body?: Buffer): Promise<GitSshResponse> {
  const channel = await new Promise<ClientChannel>((resolve, reject) => {
    client.exec(`${service} ${quoted(repoPath)}`, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
  return new Promise((resolve, reject) => {
    let output = Buffer.alloc(0);
    let errors = '';
    let advertised = -1;
    channel.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    channel.on('data', (chunk: Buffer) => {
      output = Buffer.concat([output, chunk]);
      if (advertised !== -1) {
        return;
      }
      try {
        advertised = flushEnd(output);
      } catch (err) {
        channel.close();
        return reject(err);
      }
      if (advertised === -1) {
        return;
      }
      if (body) {
        channel.end(body);
      } else {
        // nothing wanted, which ends the service
        channel.end('0000');
      }
    });
    channel.on('close', (code: number | null) => {
      if (advertised === -1) {
        return reject(new Error(errors.trim() || `${service} ended before listing the repository's refs${code ? ` (exit ${code})` : ''}`));
      }
      if (body) {
        const result = output.subarray(advertised);
        if (!result.length && errors.trim()) {
          return reject(new Error(errors.trim()));
        }
        return resolve({ statusCode: 200, statusMessage: 'OK', headers: { 'content-type': `application/x-${service}-result` }, body: result });
      }
      const head = Buffer.from(`${pktLine(`# service=${service}\n`)}0000`);
      resolve({
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': `application/x-${service}-advertisement` },
        body: Buffer.concat([head, output.subarray(0, advertised)]),
      });
    });
  });
}
