/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { utils } from 'ssh2';
import YAML from 'yaml';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { hasGit, startSshGitServer } from '../../../__jest__/ssh-git-server';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR, type GitCredentials } from '../../../sync/git/git-vcs';
import { MemClient } from '../../../sync/git/mem-client';
import { NeDBClient } from '../../../sync/git/ne-db-client';
import { routableFSClient } from '../../../sync/git/routable-fs-client';
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

  it("won't connect to a host that isn't trusted", async () => {
    write('id_ed25519', server.clientKey);
    askToTrust.mockResolvedValue(false);
    const remote = server.createRepo({ [file(workspace)]: YAML.stringify(workspace) });

    await expect(clone(remote.url)).rejects.toThrow(`the host key of [127.0.0.1]:${server.port} wasn't trusted`);
    expect(fs.existsSync(env.appKnownHostsFile)).toBe(false);
  });

  it('refuses a host whose key has changed, without asking', async () => {
    write('id_ed25519', server.clientKey);
    const other = utils.parseKey(utils.generateKeyPairSync('ed25519').public) as { getPublicSSH(): Buffer };
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
    const locked = utils.generateKeyPairSync('ed25519', { passphrase: 'open sesame', cipher: 'aes256-ctr', rounds: 2 });
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

    write('id_ed25519', utils.generateKeyPairSync('ed25519').private);
    await expect(clone(remote.url)).rejects.toThrow(`didn't accept the keys tried (${path.join(sshDir(), 'id_ed25519')})`);
  });
});
