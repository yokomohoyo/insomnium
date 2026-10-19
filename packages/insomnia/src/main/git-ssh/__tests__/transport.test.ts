/**
 * @jest-environment node
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BaseAgent, type ParsedKey, utils } from 'ssh2';
import YAML from 'yaml';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { hasGit, keyPair, startSshGitServer } from '../../../__jest__/ssh-git-server';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR, type GitCredentials } from '../../../sync/git/git-vcs';
import { MemClient } from '../../../sync/git/mem-client';
import { NeDBClient } from '../../../sync/git/ne-db-client';
import { routableFSClient } from '../../../sync/git/routable-fs-client';
import { remoteUrlFor } from '../../../sync/git/ssh-url';
import { knownHostsLine } from '../known-hosts';
import { gitSshRequest, type SshEnvironment } from '../transport';

// the real clone (the tests' mock of isomorphic-git stubs it)
jest.unmock('isomorphic-git');
// Real SSH handshakes. Under jest (not in plain node), the first one in a test
// after a test that turned a host down takes about five seconds.
jest.setTimeout(20_000);

const workspace = { _id: 'wrk_1', type: models.workspace.type, parentId: null, name: 'Pets', scope: 'collection' };
const request = { _id: 'req_1', type: models.request.type, parentId: 'wrk_1', name: 'list pets', method: 'GET', url: 'https://pets.example.com/pets' };
const file = (doc: { _id: string; type: string }) => `.insomnium/${doc.type}/${doc._id}.yml`;

// a key's public half, in its wire form, from either half's text
const publicOf = (text: string) => (utils.parseKey(text) as ParsedKey).getPublicSSH().toString('base64');

// an agent holding these keys, as ssh-agent would
class TestAgent extends BaseAgent {
  keys: { public: ParsedKey; private: ParsedKey }[];

  constructor(...pairs: { public: string; private: string; passphrase?: string }[]) {
    super();
    this.keys = pairs.map(pair => ({ public: utils.parseKey(pair.public) as ParsedKey, private: utils.parseKey(pair.private, pair.passphrase) as ParsedKey }));
  }

  getIdentities(callback: (err: Error | null, keys?: ParsedKey[]) => void) {
    callback(null, this.keys.map(key => key.public));
  }

  sign(pubKey: ParsedKey, data: Buffer, options: { hash?: string } | undefined, callback: (err: Error | null, signature?: Buffer) => void) {
    const key = this.keys.find(candidate => candidate.public.getPublicSSH().equals(pubKey.getPublicSSH()));
    callback(null, key!.private.sign(data, options?.hash) as Buffer);
  }
}

(hasGit ? describe : describe.skip)('Git over SSH', () => {
  let server: Awaited<ReturnType<typeof startSshGitServer>>;
  let home: string;
  let env: SshEnvironment;
  const askToTrust = jest.fn<SshEnvironment['askToTrust']>();
  const sshDir = () => path.join(home, '.ssh');
  const write = (name: string, text: string) => {
    fs.mkdirSync(sshDir(), { recursive: true });
    fs.writeFileSync(path.join(sshDir(), name), text, { mode: 0o600 });
  };
  const trustServer = () => write('known_hosts', `${knownHostsLine('127.0.0.1', server.port, server.hostKey)}\n`);

  const clone = (url: string, gitCredentials: GitCredentials | null = null) => GitVCS.initFromClone({
    repoId: 'git_1',
    url,
    gitCredentials,
    directory: GIT_CLONE_DIR,
    fs: routableFSClient(MemClient.createClient(), {
      [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
      [GIT_INTERNAL_DIR]: MemClient.createClient(),
    }),
    gitDirectory: GIT_INTERNAL_DIR,
    workspaceId: 'wrk_1',
  });

  beforeAll(async () => {
    server = await startSshGitServer();
    // the renderer's HTTP client asks the main process, which this stands in for
    (globalThis as any).window = { main: { gitSshRequest: (req: Parameters<typeof gitSshRequest>[0]) => gitSshRequest(req, env) } };
  });
  afterAll(async () => {
    delete (globalThis as any).window;
    await server.close();
  });

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    await models.workspace.create({ ...workspace, parentId: DEFAULT_PROJECT_ID });
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-ssh-home-'));
    // no agent: only the keys these tests give
    env = { home, agents: [], appKnownHostsFile: path.join(home, 'app', 'known_hosts'), askToTrust };
    askToTrust.mockReset();
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('clones, pulls and pushes, trusting the host once when asked', async () => {
    write('id_ed25519', server.clientKey);
    askToTrust.mockResolvedValue(true);
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace), [file(request)]: YAML.stringify(request) });

    await clone(remote.url);
    expect(await models.request.getById('req_1')).toMatchObject({ name: 'list pets' });
    expect(askToTrust).toHaveBeenCalledTimes(1);
    expect(askToTrust.mock.calls[0][0]).toMatchObject({ host: `[127.0.0.1]:${server.port}`, keyType: 'ssh-ed25519', otherTypesKnown: false });
    expect(fs.readFileSync(env.appKnownHostsFile, 'utf8')).toBe(`${knownHostsLine('127.0.0.1', server.port, server.hostKey)}\n`);

    await GitVCS.setAuthor('Ana', 'ana@example.com');
    remote.push({ [file(request)]: YAML.stringify({ ...request, name: 'list all pets' }) }, 'rename');
    await GitVCS.pull();
    expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets' });

    await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
    await GitVCS.add(file({ _id: 'req_2', type: models.request.type }));
    await GitVCS.commit('add pet');
    await GitVCS.push();
    expect(remote.log()).toEqual(['add pet', 'rename', 'first']);

    // trusted now, so not asked again
    expect(askToTrust).toHaveBeenCalledTimes(1);
    expect(server.accepted.every(user => user === 'git')).toBe(true);
  });

  it('takes a pack that comes in many pieces', async () => {
    trustServer();
    write('id_ed25519', server.clientKey);
    // random, so it doesn't compress: many of the channel's packets
    const description = crypto.randomBytes(400_000).toString('hex');
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace), [file(request)]: YAML.stringify({ ...request, description }) });

    await clone(remote.url);
    expect((await models.request.getById('req_1'))?.description).toBe(description);
  });

  it("won't connect to a host that isn't trusted", async () => {
    write('id_ed25519', server.clientKey);
    askToTrust.mockResolvedValue(false);
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });

    await expect(clone(remote.url)).rejects.toThrow(`the host key of [127.0.0.1]:${server.port} wasn't trusted`);
    expect(fs.existsSync(env.appKnownHostsFile)).toBe(false);
  });

  it('refuses a host whose key has changed, without asking', async () => {
    write('id_ed25519', server.clientKey);
    const other = utils.parseKey(keyPair().public) as { getPublicSSH(): Buffer };
    write('known_hosts', `${knownHostsLine('127.0.0.1', server.port, other.getPublicSSH())}\n`);
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });

    await expect(clone(remote.url)).rejects.toThrow(/isn't the one trusted for it \(.*known_hosts, line 1\)/);
    expect(askToTrust).not.toHaveBeenCalled();
  });

  it("takes the host, port, user and key from ~/.ssh/config's Host block", async () => {
    trustServer();
    write('work_ed25519', server.clientKey);
    write('config', `Host work\n  HostName 127.0.0.1\n  Port ${server.port}\n  User git\n  IdentityFile ~/.ssh/work_ed25519\n`);
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace), [file(request)]: YAML.stringify(request) });

    // the scp-like form, as the repository's address would be written for that alias
    await clone(`work:${remote.name}`);
    expect(await models.request.getById('req_1')).toMatchObject({ name: 'list pets' });
  });

  it("uses the repository's own key file, with its passphrase", async () => {
    trustServer();
    const locked = keyPair({ passphrase: 'open sesame', cipher: 'aes256-ctr', rounds: 2 });
    server.allowKey(locked.public);
    const keyFile = path.join(home, 'keys', 'insomnium');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, locked.private, { mode: 0o600 });
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace), [file(request)]: YAML.stringify(request) });

    await expect(clone(remote.url, { username: '', password: '', sshKey: keyFile })).rejects.toThrow(`${keyFile} needs its passphrase`);

    await globalBeforeEach();
    await models.workspace.create({ ...workspace, parentId: DEFAULT_PROJECT_ID });
    await clone(remote.url, { username: '', password: '', sshKey: keyFile, sshPassphrase: 'open sesame' });
    expect(await models.request.getById('req_1')).toMatchObject({ name: 'list pets' });
  });

  it('says so when it has no key the server takes', async () => {
    trustServer();
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });
    await expect(clone(remote.url)).rejects.toThrow("git@127.0.0.1 didn't accept a key: none was found in the SSH agent or ~/.ssh");

    write('id_ed25519', keyPair().private);
    await expect(clone(remote.url)).rejects.toThrow(`didn't accept the keys tried (${path.join(sshDir(), 'id_ed25519')})`);
  });

  describe('the keys it offers', () => {
    // each key offered, once, in order
    const offered = () => [...new Set(server.offered.map(key => key.toString('base64')))];
    const keyFile = () => path.join(home, 'keys', 'insomnium');
    const writeKeyFile = (text: string) => {
      fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
      fs.writeFileSync(keyFile(), text, { mode: 0o600 });
    };
    beforeEach(() => {
      server.offered.length = 0;
      trustServer();
    });

    it("offers the repository's key, and none of the agent's others", async () => {
      const other = keyPair();
      server.allowKey(other.public);
      env.agents = [new TestAgent(other)];
      writeKeyFile(server.clientKey);
      const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });

      await clone(remote.url, { username: '', password: '', sshKey: keyFile() });
      expect(offered()).toEqual([publicOf(server.clientKey)]);
    });

    it("signs with the agent's copy of a locked repository key, known by its .pub", async () => {
      const locked = keyPair({ passphrase: 'open sesame', cipher: 'aes256-ctr', rounds: 2 });
      const other = keyPair();
      server.allowKey(locked.public);
      server.allowKey(other.public);
      env.agents = [new TestAgent(other, { ...locked, passphrase: 'open sesame' })];
      writeKeyFile(locked.private);
      fs.writeFileSync(`${keyFile()}.pub`, locked.public);
      const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });

      await clone(remote.url, { username: '', password: '', sshKey: keyFile() });
      expect(offered()).toEqual([publicOf(locked.public)]);
    });

    it("tries IdentityFile's key, then the agent's, then ~/.ssh/id_*", async () => {
      const work = keyPair();
      const agentKey = keyPair();
      write('work_ed25519', work.private);
      write('id_ed25519', server.clientKey);
      write('config', 'Host 127.0.0.1\n  IdentityFile ~/.ssh/work_ed25519\n');
      env.agents = [new TestAgent(agentKey)];
      const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });

      await clone(remote.url);
      expect(offered()).toEqual([publicOf(work.public), publicOf(agentKey.public), publicOf(server.clientKey)]);
    });

    it("with IdentitiesOnly, offers only IdentityFile's keys, the agent's copies of them too", async () => {
      const work = keyPair();
      const other = keyPair();
      server.allowKey(other.public);
      write('work_ed25519', work.private);
      write('id_ed25519', server.clientKey);
      write('config', 'Host 127.0.0.1\n  IdentitiesOnly yes\n  IdentityFile ~/.ssh/work_ed25519\n');
      env.agents = [new TestAgent(other, work)];
      const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });

      await expect(clone(remote.url)).rejects.toThrow(`didn't accept the keys tried (${path.join(sshDir(), 'work_ed25519')}, the SSH agent)`);
      expect(offered()).toEqual([publicOf(work.public)]);
    });
  });
});

describe('gitSshRequest', () => {
  it('refuses a repository path that starts with -, before connecting', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-ssh-home-'));
    const askToTrust = jest.fn<SshEnvironment['askToTrust']>();
    const url = `${remoteUrlFor('git@127.0.0.1:-oops/api.git')}/info/refs?service=git-upload-pack`;
    try {
      await expect(gitSshRequest({ url, method: 'GET', headers: {} }, { home, agents: [], appKnownHostsFile: path.join(home, 'known_hosts'), askToTrust }))
        .rejects.toThrow('The repository path -oops/api.git starts with "-"');
      expect(askToTrust).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
