import { execFileSync, spawn } from 'child_process';
import express from 'express';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// A repository to clone over HTTP, served by git's own http-backend:
// example.git, two commits on main. Pushing needs smoke:token.
export const gitRouter = express.Router();

const root = mkdtempSync(join(tmpdir(), 'smoke-git-'));
const work = join(root, 'work');
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', ...args], { cwd });

// without git on this computer, only the specs that clone go without
let missing = '';
try {
  git(root, 'init', '--bare', '--initial-branch=main', 'example.git');
  git(join(root, 'example.git'), 'config', 'http.receivepack', 'true');
  git(root, 'init', '--initial-branch=main', 'work');
  writeFileSync(join(work, 'README.md'), '# Example\n');
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'first commit');
  writeFileSync(join(work, 'README.md'), '# Example\n\nA second line.\n');
  git(work, 'commit', '-am', 'second commit');
  git(work, 'push', '--quiet', join(root, 'example.git'), 'main');
} catch (error) {
  missing = error instanceof Error ? error.message : String(error);
}

const isPush = (req: express.Request) =>
  req.path.endsWith('/git-receive-pack') || req.query.service === 'git-receive-pack';

gitRouter.use((req, res) => {
  if (missing) {
    res.status(503).send(`No repository: ${missing}`);
    return;
  }
  if (isPush(req) && req.headers.authorization !== `Basic ${Buffer.from('smoke:token').toString('base64')}`) {
    res.status(401).header('WWW-Authenticate', 'Basic realm="smoke"').send('Unauthorized');
    return;
  }
  const backend = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      REMOTE_USER: 'smoke',
      PATH_INFO: req.path,
      REQUEST_METHOD: req.method,
      QUERY_STRING: new URL(req.url, 'http://localhost').search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] || '',
    },
  });
  req.pipe(backend.stdin);

  // a CGI answer: headers, a blank line, then the body
  let head = Buffer.alloc(0);
  let sentHead = false;
  backend.stdout.on('data', (chunk: Buffer) => {
    if (sentHead) {
      res.write(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end === -1) {
      return;
    }
    for (const line of head.subarray(0, end).toString().split('\r\n')) {
      const [name, ...value] = line.split(':');
      if (name.toLowerCase() === 'status') {
        res.status(Number.parseInt(value.join(':').trim()));
      } else {
        res.setHeader(name, value.join(':').trim());
      }
    }
    sentHead = true;
    res.write(head.subarray(end + 4));
  });
  backend.stdout.on('end', () => res.end());
  backend.on('error', error => res.status(500).send(error.message));
});
