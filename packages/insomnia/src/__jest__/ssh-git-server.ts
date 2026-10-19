// A Git remote over SSH for tests: ssh2's server, which runs git's own
// upload-pack and receive-pack on bare repositories in a temporary folder, and
// takes one client key. Commits are made and pushed by the git CLI, as in
// git-server.ts. Tests that use it skip where git isn't installed.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { type ParsedKey, Server, utils } from 'ssh2';

import { runGit } from './git-server';

export const hasGit = spawnSync('git', ['--version']).status === 0;

const publicKey = (text: string) => utils.parseKey(text) as ParsedKey;

export async function startSshGitServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-ssh-remote-'));
  const hostKeys = utils.generateKeyPairSync('ed25519');
  const clientKeys = utils.generateKeyPairSync('ed25519');
  const allowed = [publicKey(clientKeys.public)];
  const accepted: string[] = [];

  const server = new Server({ hostKeys: [hostKeys.private] }, client => {
    client.on('authentication', context => {
      const key = context.method === 'publickey' && allowed.find(candidate => context.key?.data.equals(candidate.getPublicSSH()));
      if (key) {
        // without a signature, it's asking whether the key would do
        if (!context.signature || key.verify(context.blob!, context.signature) === true) {
          accepted.push(context.username);
          return context.accept();
        }
      }
      context.reject(['publickey']);
    });
    client.on('session', acceptSession => {
      acceptSession().on('exec', (acceptExec, reject, { command }) => {
        const match = command.match(/^git-(upload-pack|receive-pack) '(.*)'$/);
        if (!match) {
          return reject();
        }
        const channel = acceptExec();
        const service = spawn('git', [match[1], path.join(root, match[2])]);
        channel.pipe(service.stdin);
        service.stdout.pipe(channel, { end: false });
        service.stderr.pipe(channel.stderr, { end: false });
        service.on('close', code => {
          channel.exit(code ?? 1);
          channel.end();
        });
      });
    });
    client.on('error', () => {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    // the client's private key, as ssh-keygen writes it
    clientKey: clientKeys.private,
    // the server's key, in its wire form
    hostKey: publicKey(hostKeys.public).getPublicSSH(),
    // the usernames signed in with
    accepted,
    // another key the server takes, by its public half
    allowKey: (text: string) => allowed.push(publicKey(text)),
    // a repository with these files in its first commit, and a way to push more
    createRepo(files: Record<string, string>) {
      const name = `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      runGit(root, 'init', '-q', '--bare', '--initial-branch=main', `${name}.git`);
      const upstream = path.join(root, name);
      runGit(root, 'clone', '-q', `${name}.git`, name);
      runGit(upstream, 'checkout', '-q', '-B', 'main');
      const push = (changes: Record<string, string>, message: string) => {
        for (const [file, content] of Object.entries(changes)) {
          fs.mkdirSync(path.dirname(path.join(upstream, file)), { recursive: true });
          fs.writeFileSync(path.join(upstream, file), content);
        }
        runGit(upstream, 'add', '-A');
        runGit(upstream, 'commit', '-q', '-m', message);
        runGit(upstream, 'push', '-q', 'origin', 'main');
      };
      push(files, 'first');
      return {
        url: `ssh://git@127.0.0.1:${port}/${name}.git`,
        name: `${name}.git`,
        push,
        // the messages on the server's main, newest first
        log: () => runGit(path.join(root, `${name}.git`), 'log', '--format=%s', 'main').split('\n'),
      };
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
