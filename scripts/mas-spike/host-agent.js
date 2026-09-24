// SPIKE ONLY (spike/mas-sandbox, never merge).
// Host-side agent for the MAS sandbox probe. Runs OUTSIDE the sandbox as the runner user.
//   node host-agent.js <evidence-dir> <sbcheck> <Insomnium.app> <lshandler> <certgen-dir>
// Control API on 127.0.0.1:18480 (the probe calls it over loopback):
//   GET  /snapshot?label=&pids=pid:type,...&renderer=  sandbox_check() every app process
//   GET  /dialog?key=&id=&drive=&pid=&path=            spawn the osascript dialog driver
//   GET  /dialog-closed?key=                            the probe saw the dialog close
//   GET  /open-url?url=                                 run `open <url>` (LaunchServices)
//   GET  /ls-handler                                    default handler for insomnia://
//   GET  /tls-log[?since=N]                             what the TLS fixture server saw
//   GET  /crash-control?kind=&pid=                      remember a crash positive control
//   GET  /update-info                                   what the simulated update changed
//   GET  /stage?...                                     log only
//   POST /report?name=     GET|POST /bookmark?name=     copies kept outside the container
// Fixtures: HTTP on Unix sockets /tmp/insomnium-probe.sock and ~/probe.sock, and HTTPS on
// 127.0.0.1:18443 that REQUIRES a client certificate signed by the probe CA.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const [EVID, SBCHECK, APP, LSHANDLER, CERTGEN] = process.argv.slice(2);
const HOME = process.env.HOME;
const HERE = __dirname;
const CONTROL_PORT = 18480;
const TLS_PORT = 18443;
const SOCKETS = ['/tmp/insomnium-probe.sock', path.join(HOME, 'probe.sock')];
const LOG = path.join(EVID, 'host-agent.log');
for (const d of ['agent-reports', 'bookmarks', 'snapshots']) {
  fs.mkdirSync(path.join(EVID, d), { recursive: true });
}

function log(...a) {
  const line = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', err => log('uncaughtException', String(err && err.stack)));

// ---------------------------------------------------------------- sandbox_check paths
const D = path.join(HOME, 'Documents');
const SB_PATHS = [
  ['file-read-data', path.join(HOME, '.netrc')],
  ['file-read-data', path.join(D, 'probe-in.txt')],
  ['file-read-data', path.join(D, 'probe-out.txt')],
  ['file-write-data', path.join(D, 'probe-out.txt')],
  ['file-read-data', path.join(HOME, 'mas-probe-plain', 'probe-plain.txt')], // plain home
  ['file-write-create', path.join(HOME, 'mas-probe-home-write.txt')], // home write
  ['file-read-data', '/etc/ssl/cert.pem'],
  ['file-read-data', D], // listing ~/Documents itself
  ['file-read-data', path.join(D, 'probe-dir', 'sub1', 'sub2', 'deep.txt')],
  ['file-write-create', path.join(D, 'probe-dir', 'host-check-new.txt')],
  ['file-read-data', path.join(D, 'protos', 'b.proto')],
  ['file-read-data', path.join(D, 'certs', 'client.key')],
  ['file-read-data', path.join(D, 'ls-in.txt')],
  ['file-write-create', path.join(HOME, 'Library', 'Group Containers', 'M4B2LM9HCJ.com.insomnium.app', 'host-check.txt')],
  ['network-outbound', '/private/tmp/insomnium-probe.sock'],
];

function kindOf(cmd) {
  if (!cmd) {
    return 'gone';
  }
  if (/--type=renderer/.test(cmd)) {
    return 'renderer';
  }
  if (/--type=gpu-process/.test(cmd)) {
    return 'gpu';
  }
  if (/network\.mojom/.test(cmd)) {
    return 'network';
  }
  const t = cmd.match(/--type=(\S+)/);
  if (t) {
    return t[1];
  }
  return /\/Contents\/MacOS\/Insomnium( |$)/.test(cmd) ? 'main' : 'other';
}

async function snapshot(label, pidSpec, rendererPid) {
  const specs = String(pidSpec || '').split(',').filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return { pid: parseInt(s.slice(0, i), 10), type: s.slice(i + 1) };
  });
  const pg = (spawnSync('pgrep', ['-f', `${APP}/Contents`], { encoding: 'utf8' }).stdout || '').split('\n').map(Number).filter(Boolean);
  for (const p of pg) {
    if (!specs.some(s => s.pid === p)) {
      specs.push({ pid: p, type: 'pgrep-only' });
    }
  }
  const args = [];
  for (const [op, p] of SB_PATHS) {
    args.push('-o', op, p);
  }
  const text = [
    `# snapshot ${label} at ${new Date().toISOString()}; main-window renderer pid from the probe: ${rendererPid || '?'}`,
    '# sandbox_check(pid, NULL): 1 = sandboxed. Per path: sandbox_check(pid, op, SANDBOX_FILTER_PATH | SANDBOX_CHECK_NO_REPORT)',
  ];
  const procs = [];
  for (const s of specs) {
    let alive = false;
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(s.pid, 0);
        alive = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    const ps = (spawnSync('ps', ['-o', 'pid=,ppid=,command=', '-p', String(s.pid)], { encoding: 'utf8' }).stdout || '').trim();
    const r = spawnSync(SBCHECK, [String(s.pid), ...args], { encoding: 'utf8', timeout: 30000 });
    text.push(`## ${s.type} | ${ps.slice(0, 260)}`, (r.stdout || '').trim(), (r.stderr || '').trim());
    let sandboxed = null;
    const deny = [];
    const allow = [];
    const other = [];
    for (const line of (r.stdout || '').split('\n')) {
      let m = line.match(/^pid=\d+ sandboxed=(-?\d+)/);
      if (m) {
        sandboxed = Number(m[1]);
        continue;
      }
      m = line.match(/^pid=\d+ (\S+) (.*) -> (allow|DENY|ERROR)$/);
      if (m) {
        const k = `${m[1]} ${m[2].split(HOME).join('~')}`;
        (m[3] === 'allow' ? allow : m[3] === 'DENY' ? deny : other).push(k);
      }
    }
    const cmd = ps.replace(/^\s*\d+\s+\d+\s+/, '');
    const certPem = allow.includes('file-read-data /etc/ssl/cert.pem') ? 'allow' : deny.includes('file-read-data /etc/ssl/cert.pem') ? 'DENY' : '?';
    procs.push({ pid: s.pid, type: s.type, kind: kindOf(cmd), alive, sandboxed, etc_ssl_cert_pem: certPem, deny, allow, other });
  }
  fs.writeFileSync(path.join(EVID, `sandbox-status-${label}.txt`), `${text.join('\n')}\n`);
  fs.writeFileSync(path.join(EVID, 'snapshots', `${label}.json`), JSON.stringify(procs, null, 2));
  const kinds = procs.map(p => `${p.kind}:${p.sandboxed}`).join(' ');
  log('snapshot', label, kinds);
  return { label, kinds, procs };
}

// ---------------------------------------------------------------- dialog driver
function startDriver(q) {
  const fd = fs.openSync(path.join(EVID, 'dialog-driver.log'), 'a');
  const child = spawn('perl', ['-e', 'alarm shift; exec @ARGV', '150', 'bash', path.join(HERE, 'drive-dialog.sh'),
    q.key || '0', q.id || 'dialog', q.drive || 'goto', q.pid || '0', q.path || '', EVID], { stdio: ['ignore', fd, fd] });
  child.on('exit', (code, sig) => log('driver exit', q.key, code, sig));
  fs.closeSync(fd);
}

// ---------------------------------------------------------------- fixtures
const unixLog = [];
function unixServer(sock) {
  try {
    fs.unlinkSync(sock);
  } catch {
    /* none */
  }
  const s = http.createServer((req, res) => {
    const e = { at: new Date().toISOString(), sock, method: req.method, url: req.url, host: req.headers.host || null };
    unixLog.push(e);
    log('unix-request', e);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ via: 'unix-socket', sock, url: req.url }));
  });
  s.on('error', e => log('unix-server-error', sock, e.code, e.message));
  s.listen(sock, () => {
    try {
      fs.chmodSync(sock, 0o777);
    } catch {
      /* ignore */
    }
    log('unix-listening', sock);
  });
}

const tlsLog = [];
function tlsServer() {
  const opts = {
    key: fs.readFileSync(path.join(CERTGEN, 'server.key')),
    cert: fs.readFileSync(path.join(CERTGEN, 'server.crt')),
    ca: [fs.readFileSync(path.join(D, 'certs', 'ca.crt'))],
    requestCert: true,
    rejectUnauthorized: true,
  };
  const s = https.createServer(opts, (req, res) => {
    const pc = req.socket.getPeerCertificate();
    const cn = pc && pc.subject ? pc.subject.CN : null;
    const e = { at: new Date().toISOString(), event: 'request', url: req.url, client_cn: cn, authorized: req.socket.authorized };
    tlsLog.push(e);
    log('tls', e);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ client_cn: cn, authorized: req.socket.authorized, url: req.url }));
  });
  s.on('tlsClientError', err => {
    const e = { at: new Date().toISOString(), event: 'tlsClientError', code: err.code || null, message: String(err.message).slice(0, 200) };
    tlsLog.push(e);
    log('tls', e);
  });
  s.on('error', e => log('tls-server-error', e.code, e.message));
  s.listen(TLS_PORT, '127.0.0.1', () => log('tls-listening', TLS_PORT));
}

// ---------------------------------------------------------------- control server
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.setEncoding('utf8');
    req.on('data', c => (b += c));
    req.on('end', () => resolve(b));
  });
}
const safe = s => String(s || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);

const control = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const q = Object.fromEntries(u.searchParams);
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (u.pathname !== '/tls-log') {
      log('control', req.method, u.pathname, JSON.stringify(q).slice(0, 300));
    }
    switch (u.pathname) {
      case '/ping':
        return send(200, { ok: true });
      case '/snapshot':
        return send(200, await snapshot(safe(q.label), q.pids, q.renderer));
      case '/dialog':
        startDriver(q);
        return send(200, { started: true, key: q.key });
      case '/dialog-closed':
        fs.writeFileSync(path.join(EVID, `.dialog-closed-${safe(q.key)}`), new Date().toISOString());
        return send(200, { ok: true });
      case '/open-url': {
        const r = spawnSync('open', [q.url], { encoding: 'utf8', timeout: 30000 });
        const out = { status: r.status, signal: r.signal, stdout: (r.stdout || '').slice(0, 300), stderr: (r.stderr || '').slice(0, 300), error: r.error ? String(r.error.message) : null };
        log('open-url', q.url, out);
        return send(200, out);
      }
      case '/ls-handler': {
        const r = spawnSync(LSHANDLER, ['insomnia'], { encoding: 'utf8', timeout: 20000 });
        return send(200, { status: r.status, stdout: (r.stdout || '').trim().split('\n'), stderr: (r.stderr || '').slice(0, 300) });
      }
      case '/tls-log': {
        const since = parseInt(q.since || '0', 10) || 0;
        return send(200, { count: tlsLog.length, entries: tlsLog.slice(since) });
      }
      case '/unix-log':
        return send(200, { count: unixLog.length, entries: unixLog });
      case '/crash-control':
        fs.appendFileSync(path.join(EVID, 'crash-control.txt'), `${q.kind} ${q.pid} ${new Date().toISOString()}\n`);
        return send(200, { ok: true });
      case '/update-info': {
        let info = null;
        try {
          info = JSON.parse(fs.readFileSync(path.join(EVID, 'update-info.json'), 'utf8'));
        } catch (e) {
          info = { error: String(e.message) };
        }
        return send(200, info);
      }
      case '/stage':
        return send(200, { ok: true });
      case '/report': {
        const body = await readBody(req);
        fs.writeFileSync(path.join(EVID, 'agent-reports', `probe-report-${safe(q.name)}.json`), body);
        return send(200, { ok: true, bytes: body.length });
      }
      case '/bookmark': {
        const f = path.join(EVID, 'bookmarks', `${safe(q.name)}.json`);
        if (req.method === 'POST') {
          fs.writeFileSync(f, await readBody(req));
          return send(200, { ok: true });
        }
        return send(200, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { bookmark: null });
      }
      default:
        return send(404, { error: 'unknown endpoint' });
    }
  } catch (err) {
    log('control-error', u.pathname, String(err && err.stack));
    return send(500, { error: String(err && err.message) });
  }
});

for (const s of SOCKETS) {
  unixServer(s);
}
try {
  tlsServer();
} catch (e) {
  log('tls-server-setup-failed', String(e && e.stack));
}
control.listen(CONTROL_PORT, '127.0.0.1', () => {
  log('control-listening', CONTROL_PORT);
  fs.writeFileSync(path.join(EVID, '.agent-ready'), String(process.pid));
});
