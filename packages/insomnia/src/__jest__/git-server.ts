// A real Git remote for tests: bare repositories in a temporary folder, served
// by git's own smart HTTP server (git http-backend), with commits made and
// pushed by the git CLI. Tests that use it skip where git-http-backend isn't
// installed (hasGitHttpBackend). They also need jest.unmock('isomorphic-git'),
// since the tests' mock of it stubs clone and push.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { env } from 'process';

export const runGit = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=Kim', '-c', 'user.email=kim@example.com', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return result.stdout.trim();
};

const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
export const hasGitHttpBackend = !!execPath && fs.existsSync(path.join(execPath, 'git-http-backend'));

const backend = (root: string) => http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const cgi = spawn('git', ['http-backend'], {
    env: {
      ...env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method,
      CONTENT_TYPE: request.headers['content-type'] || '',
      CONTENT_LENGTH: request.headers['content-length'] || '',
      HTTP_CONTENT_ENCODING: String(request.headers['content-encoding'] || ''),
      REMOTE_ADDR: '127.0.0.1',
    },
  });
  request.pipe(cgi.stdin);
  let head = Buffer.alloc(0);
  let started = false;
  cgi.stdout.on('data', (chunk: Buffer) => {
    if (started) {
      response.write(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end === -1) {
      return;
    }
    let status = 200;
    const headers: Record<string, string> = {};
    for (const line of head.subarray(0, end).toString().split('\r\n')) {
      const [name, ...value] = line.split(':');
      if (name.toLowerCase() === 'status') {
        status = parseInt(value.join(':'), 10);
      } else {
        headers[name] = value.join(':').trim();
      }
    }
    response.writeHead(status, headers);
    response.write(head.subarray(end + 4));
    started = true;
  });
  cgi.stdout.on('end', () => response.end());
});

export interface GitRemote {
  url: string;
  // commits these files (null removes one) to main, and pushes
  push(files: Record<string, string | null>, message: string): void;
}

export async function startGitServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-remote-'));
  const server = backend(root);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    // a new repository on the server, with these files in its first commit
    createRepo(files: Record<string, string>, message = 'first'): GitRemote {
      const name = `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      runGit(root, 'init', '-q', '--bare', '--initial-branch=main', `${name}.git`);
      const upstream = path.join(root, name);
      runGit(root, 'clone', '-q', `${name}.git`, name);
      runGit(upstream, 'checkout', '-q', '-B', 'main');
      const push = (changes: Record<string, string | null>, commitMessage: string) => {
        for (const [file, content] of Object.entries(changes)) {
          const filepath = path.join(upstream, file);
          if (content === null) {
            fs.rmSync(filepath, { force: true });
          } else {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
            fs.writeFileSync(filepath, content);
          }
        }
        runGit(upstream, 'add', '-A');
        runGit(upstream, 'commit', '-q', '-m', commitMessage);
        runGit(upstream, 'push', '-q', 'origin', 'main');
      };
      push(files, message);
      return { url: `http://127.0.0.1:${port}/${name}.git`, push };
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
