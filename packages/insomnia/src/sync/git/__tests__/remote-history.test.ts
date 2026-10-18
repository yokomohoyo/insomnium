/**
 * @jest-environment node
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as git from 'isomorphic-git';
import YAML from 'yaml';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR } from '../git-vcs';
import { MemClient } from '../mem-client';
import { NeDBClient } from '../ne-db-client';
import { routableFSClient } from '../routable-fs-client';

// the real clone (the tests' mock of isomorphic-git stubs it), and the app's
// client, which goes through the main process, straight to the server instead
jest.unmock('isomorphic-git');
jest.mock('../http-client', () => ({ httpClient: jest.requireActual('isomorphic-git/http/node') }));

// A real remote: a bare repository served by git's own smart HTTP server
// (git http-backend), with commits pushed to it by git itself
const run = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=Kim', '-c', 'user.email=kim@example.com', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return result.stdout.trim();
};
const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
const hasBackend = !!execPath && fs.existsSync(path.join(execPath, 'git-http-backend'));

const backend = (root: string) => http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const cgi = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
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

const workspace = { _id: 'wrk_1', type: models.workspace.type, parentId: null, name: 'Pets', scope: 'collection' };
const request = { _id: 'req_1', type: models.request.type, parentId: 'wrk_1', name: 'list pets', method: 'GET', url: 'https://pets.example.com/pets' };
const file = (doc: { _id: string; type: string }) => `.insomnium/${doc.type}/${doc._id}.yml`;

(hasBackend ? describe : describe.skip)('pulling from a remote', () => {
  let root: string;
  let server: http.Server;
  let port: number;
  let upstream: string;

  // a commit made elsewhere and pushed
  const pushUpstream = (docs: object[], message: string) => {
    for (const doc of docs as { _id: string; type: string }[]) {
      const filepath = path.join(upstream, file(doc));
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
      fs.writeFileSync(filepath, YAML.stringify(doc));
    }
    run(upstream, 'add', '.');
    run(upstream, 'commit', '-m', message);
    run(upstream, 'push', '-q', 'origin', 'main');
  };
  const shallowFile = () => (GitVCS.getFs() as git.PromiseFsClient).promises.readFile(path.join(GIT_INTERNAL_DIR, 'shallow'), 'utf8').then(String, () => '');

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-remote-'));
    server = backend(root);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    await models.workspace.create({ ...workspace, parentId: DEFAULT_PROJECT_ID });

    const name = `pets-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    run(root, 'init', '-q', '--bare', '--initial-branch=main', `${name}.git`);
    upstream = path.join(root, name);
    run(root, 'clone', '-q', `${name}.git`, name);
    run(upstream, 'checkout', '-q', '-B', 'main');
    pushUpstream([workspace, request], 'first');

    await GitVCS.initFromClone({
      repoId: 'git_1',
      url: `http://127.0.0.1:${port}/${name}.git`,
      directory: GIT_CLONE_DIR,
      fs: routableFSClient(MemClient.createClient(), {
        [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
        [GIT_INTERNAL_DIR]: MemClient.createClient(),
      }),
      gitDirectory: GIT_INTERNAL_DIR,
      workspaceId: 'wrk_1',
    });
    await GitVCS.setAuthor('Ana', 'ana@example.com');
  });

  afterEach(() => jest.restoreAllMocks());

  it("merges what was pushed since the last fetch, however many commits, with this side's own", async () => {
    // a commit here, so the pull is a merge, which needs where the two sides parted
    await models.request.create({ _id: 'req_2', parentId: 'wrk_1', name: 'add pet' });
    await GitVCS.add(file({ _id: 'req_2', type: models.request.type }));
    await GitVCS.commit('add pet');
    pushUpstream([{ ...request, name: 'list all pets' }], 'rename');
    pushUpstream([{ ...request, name: 'list all pets', url: 'https://pets.example.com/v2/pets' }], 'v2');

    // the Git Sync menu's fetch (every five minutes), then a pull
    await GitVCS.fetch({ singleBranch: true });
    await GitVCS.pull();

    expect(await models.request.getById('req_1')).toMatchObject({ name: 'list all pets', url: 'https://pets.example.com/v2/pets' });
    expect(await models.request.getById('req_2')).toMatchObject({ name: 'add pet' });
    expect(await shallowFile()).toBe('');
    // (isomorphic-git's log lists a merge's common ancestor once for each side)
    const history = (await GitVCS.log()).map(entry => entry.commit.message.trim());
    expect(history[0]).toMatch(/^Merge/);
    expect(new Set(history)).toEqual(new Set([history[0], 'v2', 'rename', 'add pet', 'first']));
  });

  it('deepens a repository an earlier version left shallow, and then pulls', async () => {
    pushUpstream([{ ...request, name: 'list all pets' }], 'rename');
    pushUpstream([{ ...request, name: 'list every pet' }], 'rename again');
    // as fetches up to 0.4.0 did
    await git.fetch({ ...GitVCS._baseOpts, remote: 'origin', depth: 1, singleBranch: true });
    expect(await shallowFile()).not.toBe('');
    pushUpstream([{ ...request, name: 'list the pets' }], 'and again');

    await GitVCS.pull();

    expect((await models.request.getById('req_1'))?.name).toBe('list the pets');
    expect(await shallowFile()).toBe('');
    expect((await GitVCS.log()).map(entry => entry.commit.message.trim())).toEqual(['and again', 'rename again', 'rename', 'first']);
  });

  it('shows the history here without going to the remote', async () => {
    const fetching = jest.spyOn(git, 'fetch');

    expect((await GitVCS.log()).map(entry => entry.commit.message.trim())).toEqual(['first']);
    expect(fetching).not.toHaveBeenCalled();
  });
});
