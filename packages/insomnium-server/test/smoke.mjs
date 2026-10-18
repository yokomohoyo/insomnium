// Smoke test for insomnium-server, with no dependencies. It starts an echo
// server, runs insomnium-server against a small collection (the bundle with
// --bundle <file>, or an image with --image <tag>), and drives it over MCP.
//   node test/smoke.mjs --bundle dist/index.js
//   node test/smoke.mjs --image insomnium-server:ci
// Then it runs the collection runner, `run`, the same way.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const [mode, target] = process.argv.slice(2);
if (!['--bundle', '--image'].includes(mode) || !target) {
  console.error('usage: smoke.mjs --bundle <dist/index.js> | --image <tag>');
  process.exit(2);
}

const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// the echo server the collection's request goes to
const seen = [];
const echo = http.createServer((req, res) => {
  seen.push({ url: req.url, secret: req.headers['x-secret'], trace: req.headers['x-trace'] });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ echoed: req.url }));
});
await new Promise(resolve => echo.listen(0, '127.0.0.1', resolve));

// a forward proxy, for checking the runner sends through HTTP_PROXY
const proxied = [];
const forwardProxy = http.createServer((req, res) => {
  proxied.push(req.url);
  const target = new URL(req.url);
  const upstream = http.request({ host: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: req.method, headers: req.headers }, answer => {
    res.writeHead(answer.statusCode, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => res.destroy());
  req.pipe(upstream);
});
await new Promise(resolve => forwardProxy.listen(0, '127.0.0.1', resolve));

const port = await freePort();
const token = randomBytes(24).toString('base64url');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-server-smoke-'));
fs.writeFileSync(path.join(dir, 'collection.yaml'), `_type: export
__export_format: 4
resources:
  - { _id: wrk_smoke, _type: workspace, parentId: null, name: Server smoke, scope: collection }
  - { _id: env_base, _type: environment, parentId: wrk_smoke, name: Base Environment, data: { base: 'http://127.0.0.1:1' } }
  - { _id: env_ci, _type: environment, parentId: env_base, name: ci, data: {} }
  - _id: req_echo
    _type: request
    parentId: wrk_smoke
    name: echo
    method: GET
    url: '{{ base }}/echo'
    headers: [{ name: X-Secret, value: '{{ secret }}' }, { name: X-Trace, value: "{% faker 'guid' %}" }]
  - { _id: req_blocked, _type: request, parentId: wrk_smoke, name: blocked, method: GET, url: 'http://example.com/' }
  - { _id: fld_pass, _type: request_group, parentId: wrk_smoke, name: passing }
  - _id: req_pass
    _type: request
    parentId: fld_pass
    name: passes
    method: GET
    url: '{{ base }}/run/{{ row }}'
    assertions:
      - { id: a1, source: status, operator: equals, value: '200' }
      - { id: a2, source: body, operator: contains, value: echoed }
  - { _id: fld_fail, _type: request_group, parentId: wrk_smoke, name: failing }
  - { _id: req_fail, _type: request, parentId: fld_fail, name: fails, method: GET, url: '{{ base }}/run', assertions: [{ id: a1, source: status, operator: equals, value: '201' }] }
`);
fs.writeFileSync(path.join(dir, 'rows.csv'), 'row\none\ntwo\n');
// the image runs as node (uid 1000), not as whoever made the 0700 temp dir
fs.chmodSync(dir, 0o755);
// where the runner writes its reports, writable by it too
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-run-out-'));
fs.chmodSync(out, 0o777);

const env = {
  INSOMNIUM_MCP_TOKEN: token,
  INSOMNIUM_ALLOWED_HOSTS: '127.0.0.1',
  INSOMNIUM_VAR_base: `http://127.0.0.1:${echo.address().port}`,
  INSOMNIUM_VAR_secret: 's3cret',
};
const args = ['--env', 'ci', '--port', String(port)];
let server;
if (mode === '--bundle') {
  server = spawn(process.execPath, [target, '--collection', path.join(dir, 'collection.yaml'), ...args], { env: { ...process.env, ...env }, stdio: 'inherit' });
} else {
  const envArgs = Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
  execFileSync('docker', ['run', '-d', '--name', 'insomnium-server-smoke', '--network', 'host', '-v', `${dir}:/data:ro`, ...envArgs, target, '--collection', '/data/collection.yaml', ...args], { stdio: 'inherit' });
}

let failed = false;
const stop = () => {
  if (mode === '--image') {
    try {
      execFileSync('docker', ['logs', 'insomnium-server-smoke'], { stdio: 'inherit' });
      execFileSync('docker', ['rm', '-f', 'insomnium-server-smoke'], { stdio: 'ignore' });
    } catch { /* already gone */ }
  } else {
    server.kill();
  }
  echo.close();
  forwardProxy.close();
};
// a command's exit code and output, without blocking: the echo server it
// sends to is in this process
const command = (file, commandArgs, commandEnv) => new Promise(resolve => {
  const child = spawn(file, commandArgs, { env: commandEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.on('close', status => resolve({ status, stdout, stderr }));
});
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  failed ||= !ok;
};

try {
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let attempt = 0; attempt < 60 && !up; attempt++) {
    up = await fetch(`${base}/health`).then(res => res.ok, () => false);
    if (!up) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  check(up, 'answers /health');

  let id = 0;
  const rpc = (method, params, authorization = `Bearer ${token}`) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const call = async (name, args) => {
    const { result } = await (await rpc('tools/call', { name, arguments: args })).json();
    return { isError: !!result.isError, data: JSON.parse(result.content[0].text) };
  };

  check((await rpc('tools/list', {}, 'Bearer wrong')).status === 401, 'refuses a wrong token');
  const init = await (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } })).json();
  check(init.result?.serverInfo?.name === 'insomnium-server', 'initializes');

  const tools = (await (await rpc('tools/list', {})).json()).result.tools.map(tool => tool.name);
  check(tools.includes('send_http_request') && tools.includes('list_requests'), 'lists the read and send tools');
  check(!tools.some(name => /^(create|update|delete|add|remove|import)_/.test(name)), 'leaves out the tools that edit');

  const [workspace] = (await call('list_workspaces', {})).data;
  const requests = (await call('list_requests', { workspaceId: workspace.id })).data;
  const byName = name => requests.find(request => request.name === name).id;

  const sent = await call('send_http_request', { requestId: byName('echo') });
  check(!sent.isError && sent.data.statusCode === 200, `sends to an allowed host (${JSON.stringify(sent.data)})`);
  check(seen[0]?.url === '/echo' && seen[0]?.secret === 's3cret', 'renders the environment, with INSOMNIUM_VAR_ values');
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(seen[0]?.trace || ''), 'renders template tags, faker loaded from the bundle');
  const response = await call('get_last_response', { requestId: byName('echo') });
  check(JSON.stringify(response.data).includes('echoed'), 'returns the response body');

  const blocked = await call('send_http_request', { requestId: byName('blocked') });
  check(blocked.isError && /not in INSOMNIUM_ALLOWED_HOSTS/.test(blocked.data.error), 'refuses a host that is not allowed');

  // the runner: the same bundle or image, as a command
  const run = (runArgs, extraEnv = {}) => {
    const runEnv = { INSOMNIUM_ALLOWED_HOSTS: '127.0.0.1', INSOMNIUM_VAR_base: env.INSOMNIUM_VAR_base, ...extraEnv };
    if (mode === '--bundle') {
      return command(process.execPath, [target, 'run', '--collection', path.join(dir, 'collection.yaml'), ...runArgs(dir, out)], { ...process.env, ...runEnv });
    }
    const envArgs = Object.entries(runEnv).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
    return command('docker', ['run', '--rm', '--network', 'host', '-v', `${dir}:/data:ro`, '-v', `${out}:/out`, ...envArgs, target, 'run', '--collection', '/data/collection.yaml', ...runArgs('/data', '/out')], process.env);
  };
  const passing = await run(data => ['--env', 'ci', '--folder', 'passing', '--data', path.join(data, 'rows.csv')]);
  check(passing.status === 0 && /passing \/ passes/.test(passing.stdout) && seen.some(({ url }) => url === '/run/two'), `run exits 0 when its assertions pass, once per data row (${passing.status}: ${passing.stdout}${passing.stderr})`);
  const failing = await run((_data, reports) => ['--env', 'ci', '--folder', 'failing', '--junit', path.join(reports, 'report.xml')]);
  const report = fs.existsSync(path.join(out, 'report.xml')) ? fs.readFileSync(path.join(out, 'report.xml'), 'utf8') : '';
  check(failing.status === 1 && /<failure message="Status code equals 201: got &quot;200&quot;"\/>/.test(report), `run exits 1 when one fails, and writes JUnit (${failing.status}: ${failing.stdout}${failing.stderr})`);
  const viaProxy = await run(data => ['--env', 'ci', '--folder', 'passing', '--data', path.join(data, 'rows.csv')], { HTTP_PROXY: `http://127.0.0.1:${forwardProxy.address().port}`, NO_PROXY: '' });
  check(viaProxy.status === 0 && proxied.some(url => url.endsWith('/run/one')), `run sends through HTTP_PROXY (${viaProxy.status}, ${proxied.length} through it: ${viaProxy.stdout}${viaProxy.stderr})`);
} catch (err) {
  check(false, `ran without errors: ${err.stack}`);
} finally {
  stop();
}
process.exit(failed ? 1 : 0);
