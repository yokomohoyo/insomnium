// SPIKE ONLY (branch spike/mas-sandbox, never merge).
//
// Empirical Mac App Store sandbox probe (round 2). Runs only when INSOMNIUM_MAS_PROBE=1,
// in the instance started by the probe's own app.relaunch() (--mas-probe-relaunched), or
// when the test script armed a one-shot phase in <userData>/mas-probe/arm.json (the cold
// `open insomnia://...` launch, where LaunchServices passes no environment).
//
// Each check is recorded as {id, where, expect_mas, result, error_code, detail}. The report
// is written to <userData>/mas-probe/probe-report-phase<P><TAG>.json after every check,
// POSTed to the host agent at the end, and printed to stdout between
// MASPROBE:REPORT-BEGIN / MASPROBE:REPORT-END.
//
// The host agent (scripts/mas-spike/host-agent.js, 127.0.0.1:18480, outside the sandbox)
// drives the file dialogs with osascript, runs sandbox_check() on every app process when
// asked (snapshot), runs `open insomnia://...`, and serves the Unix-socket and the
// client-certificate TLS fixtures.
//
// Phases (INSOMNIUM_MAS_PROBE_PHASE):
//   1         env, fs, file/save/directory/.proto/client-cert dialogs, Unix sockets,
//             network, insomnia:// handler, child processes, MCP, crash positive controls
//   2         persistence: file, save, directory (+ renderer write stream) and cert bookmarks
//   3         app.relaunch(); the relaunched instance writes relaunched<TAG>.json
//   lsd       LaunchServices-launched instance: app group, file/save grants, open-url
//   url-cold  started by `open insomnia://...` while the app was not running
//   4         after a simulated update (CFBundleVersion bump + re-sign): old bookmarks

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

import { app, BrowserWindow, dialog, net } from 'electron';

type Where = 'main' | 'renderer' | 'host';

interface Check {
  id: string;
  where: Where;
  expect_mas: string;
  result: 'ok' | 'error';
  error_code: string | null;
  detail: any;
  ms: number;
}

const RELAUNCH_FLAG = '--mas-probe-relaunched';
const phase = process.argv.includes(RELAUNCH_FLAG) ? 'relaunched' : (process.env.INSOMNIUM_MAS_PROBE_PHASE || '1');
// Optional report-name suffix, e.g. "-ls" for the LaunchServices-launched relaunch run.
const TAG = process.env.INSOMNIUM_MAS_PROBE_TAG ? `-${process.env.INSOMNIUM_MAS_PROBE_TAG}` : '';
const checks: Check[] = [];
const processGone: any[] = [];
const startedAt = new Date().toISOString();
const realHome = process.env.INSOMNIUM_MAS_PROBE_REAL_HOME || os.userInfo().homedir;
const AGENT = process.env.INSOMNIUM_MAS_PROBE_AGENT || 'http://127.0.0.1:18480';
const J = JSON.stringify;

const docs = path.join(realHome, 'Documents');
const docsIn = path.join(docs, 'probe-in.txt');
const docsOut = path.join(docs, 'probe-out.txt');
const plainFile = path.join(realHome, 'mas-probe-plain', 'probe-plain.txt');
const netrcPath = path.join(realHome, '.netrc');
const probeDirFx = path.join(docs, 'probe-dir');
const protosDir = path.join(docs, 'protos');
const protoA = path.join(protosDir, 'a.proto');
const protoB = path.join(protosDir, 'b.proto');
const certsDir = path.join(docs, 'certs');
const caPath = path.join(certsDir, 'ca.crt');
const certPath = path.join(certsDir, 'client.crt');
const keyPath = path.join(certsDir, 'client.key');
const lsIn = path.join(docs, 'ls-in.txt');
const lsOut = path.join(docs, 'ls-out.txt');
const groupFile = path.join(realHome, 'Library', 'Group Containers', 'M4B2LM9HCJ.com.insomnium.app', 'mas-probe.txt');
const SOCKETS: [string, string][] = [['tmp', '/tmp/insomnium-probe.sock'], ['home', path.join(realHome, 'probe.sock')]];
const TLS_PORT = 18443;
const CLIENT_CN = 'mas-probe-client';
const caPemFromEnv = process.env.INSOMNIUM_MAS_PROBE_CA_B64 ? Buffer.from(process.env.INSOMNIUM_MAS_PROBE_CA_B64, 'base64').toString('utf8') : null;
// Tiny, dependency-free and not deprecated on npm (a deprecated one makes
// `yarn info` print a warning, which install-plugin.ts treats as failure).
const PLUGIN = 'insomnia-plugin-jsonc';

let probeDir = '';

function out(line: string) {
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    /* stdout closed (LaunchServices launch) */
  }
}

function stage(name: string, extra?: any) {
  out(`MASPROBE:STAGE ${name}${extra === undefined ? '' : ' ' + J(extra)}`);
}

function probeError(code: string, detail: any) {
  return { __probe_error: true, code, detail };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const e: any = new Error(`timeout after ${ms}ms: ${label}`);
      e.code = 'PROBE_TIMEOUT';
      reject(e);
    }, ms);
    p.then(v => {
      clearTimeout(t);
      resolve(v);
    }, e => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function waitFor<T>(fn: () => T | null | undefined | false, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) {
      return v;
    }
    await sleep(250);
  }
  return null;
}

function bundleVersion() {
  try {
    const plist = fs.readFileSync(path.join(path.dirname(process.execPath), '..', 'Info.plist'), 'utf8');
    const m = plist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/);
    return m ? m[1] : null;
  } catch (err: any) {
    return `unreadable: ${err?.code}`;
  }
}

function buildReport(extra: Record<string, any> = {}) {
  return {
    probe: 'insomnium-mas-sandbox-spike-r2',
    phase,
    tag: TAG,
    // informational only: Electron sets process.mas (and getAppMetrics().sandboxed) from the build flavor
    process_mas: (process as any).mas ?? null,
    pid: process.pid,
    os_release: os.release(),
    bundle_version: bundleVersion(),
    started_at: startedAt,
    written_at: new Date().toISOString(),
    real_home: realHome,
    user_data: app.getPath('userData'),
    checks,
    process_gone: processGone,
    open_urls: openUrls(),
    ...extra,
  };
}

function flush(extra: Record<string, any> = {}) {
  try {
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, `probe-report-phase${phase}${TAG}.json`), J(buildReport(extra), null, 2));
  } catch (err: any) {
    out(`MASPROBE:FLUSH-FAILED ${err?.code} ${err?.message}`);
  }
}

async function check(id: string, where: Where, expect_mas: string, fn: () => any, timeoutMs = 30000): Promise<Check> {
  const start = Date.now();
  let entry: Check;
  try {
    const detail = await withTimeout(Promise.resolve().then(fn), timeoutMs, id);
    if (detail && detail.__probe_error) {
      entry = { id, where, expect_mas, result: 'error', error_code: String(detail.code), detail: detail.detail, ms: Date.now() - start };
    } else {
      entry = { id, where, expect_mas, result: 'ok', error_code: null, detail: detail ?? null, ms: Date.now() - start };
    }
  } catch (err: any) {
    entry = {
      id,
      where,
      expect_mas,
      result: 'error',
      error_code: String(err?.code || err?.name || 'ERROR'),
      detail: String(err?.message || err),
      ms: Date.now() - start,
    };
  }
  checks.push(entry);
  out(`MASPROBE:CHECK ${J(entry)}`);
  flush();
  return entry;
}

function head(s: string, n = 120) {
  return s.length > n ? `${s.slice(0, n)}...(${s.length} chars)` : s;
}

const openUrls = (): any[] => (globalThis as any).__masProbeOpenUrls || [];

// ---------- HTTP + host agent ----------

function httpRequest(url: string, opts: { method?: string; body?: string; timeoutMs?: number; socketPath?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers: Record<string, string | number> = {};
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(opts.body);
    }
    const req = http.request({
      method: opts.method || 'GET',
      hostname: u.hostname,
      port: u.port || 80,
      path: `${u.pathname}${u.search}`,
      socketPath: opts.socketPath,
      headers,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(opts.timeoutMs ?? 15000, () => req.destroy(Object.assign(new Error('http timeout'), { code: 'ETIMEDOUT' })));
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

async function agent(p: string, opts: { method?: string; body?: any; timeoutMs?: number } = {}): Promise<any> {
  const r = await httpRequest(`${AGENT}${p}`, {
    method: opts.method,
    body: opts.body === undefined ? undefined : J(opts.body),
    timeoutMs: opts.timeoutMs ?? 30000,
  });
  let body: any = r.body;
  try {
    body = JSON.parse(r.body);
  } catch {
    /* plain text */
  }
  if (r.status !== 200) {
    throw Object.assign(new Error(`agent ${p} -> HTTP ${r.status}: ${head(String(r.body), 200)}`), { code: `AGENT_HTTP_${r.status}` });
  }
  return body;
}

function agentQuiet(p: string, opts: { method?: string; body?: any; timeoutMs?: number } = {}) {
  return agent(p, opts).catch(err => {
    out(`MASPROBE:AGENT-ERROR ${p.slice(0, 80)} ${err?.code} ${err?.message}`);
    return null;
  });
}

// Host-side sandbox_check() of every app process (main, renderer, GPU, network, ...),
// requested only after the renderer is up so the renderer pid is always included.
async function snapshot(label: string) {
  const full = `${label}${TAG}`;
  const rendererPid = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getOSProcessId() : null;
  const procs = app.getAppMetrics().map(m => `${m.pid}:${m.type}${(m as any).serviceName ? `/${(m as any).serviceName}` : ''}`);
  if (rendererPid && !procs.some(p => p.startsWith(`${rendererPid}:`))) {
    procs.push(`${rendererPid}:MainWindowRenderer`);
  }
  await check(`snapshot-${label}`, 'host',
    'MAS: every process sandboxed=1 and helpers allow /etc/ssl/cert.pem (App Sandbox); control: main+renderer sandboxed=0, GPU/network Chromium-seatbelted (cert.pem DENY)',
    () => agent(`/snapshot?label=${encodeURIComponent(full)}&renderer=${rendererPid ?? ''}&pids=${encodeURIComponent(procs.join(','))}`, { timeoutMs: 90000 }),
    95000);
}

// ---------- dialogs (driven by the host agent with osascript) ----------

let dialogN = 0;

function requestDrive(id: string, drive: string, drivePath: string) {
  const n = ++dialogN;
  const key = `${phase}${TAG}-${n}`;
  stage('dialog', { key, id, drive, path: drivePath });
  agentQuiet(`/dialog?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}&drive=${drive}&pid=${process.pid}&path=${encodeURIComponent(drivePath)}`);
  return key;
}

function dialogDone(key: string, info: any) {
  stage('dialog-closed', { key, ...info });
  agentQuiet(`/dialog-closed?key=${encodeURIComponent(key)}`);
}

async function openDriven(id: string, drive: string, drivePath: string, opts: Electron.OpenDialogOptions): Promise<any> {
  app.focus({ steal: true });
  const key = requestDrive(id, drive, drivePath);
  const r: any = await dialog.showOpenDialog({ title: `MASPROBE ${id}`, securityScopedBookmarks: true, ...opts });
  dialogDone(key, { canceled: r.canceled, filePaths: r.filePaths });
  return r;
}

async function saveDriven(id: string, drive: string, drivePath: string, opts: Electron.SaveDialogOptions): Promise<any> {
  app.focus({ steal: true });
  const key = requestDrive(id, drive, drivePath);
  const r: any = await dialog.showSaveDialog({ title: `MASPROBE ${id}`, securityScopedBookmarks: true, ...opts });
  dialogDone(key, { canceled: r.canceled, filePath: r.filePath });
  return r;
}

// ---------- bookmarks ----------

function saveBookmark(name: string, bookmark: string | undefined | null, forPath: string | undefined | null) {
  const rec = { name, bookmark: bookmark || null, path: forPath || null, phase, saved_at: new Date().toISOString() };
  try {
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, `bookmark-${name}.json`), J(rec));
  } catch (err: any) {
    out(`MASPROBE:BOOKMARK-SAVE-FAILED ${name} ${err?.code}`);
  }
  // copy outside the container, in case the post-update build cannot use it
  return agentQuiet(`/bookmark?name=${encodeURIComponent(name)}`, { method: 'POST', body: rec });
}

async function loadBookmark(name: string): Promise<{ bookmark: string | null; source: string; path?: string | null }> {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(probeDir, `bookmark-${name}.json`), 'utf8'));
    if (j.bookmark) {
      return { bookmark: j.bookmark, source: 'userData', path: j.path };
    }
  } catch {
    /* fall through */
  }
  try {
    const j = await agent(`/bookmark?name=${encodeURIComponent(name)}`);
    if (j && j.bookmark) {
      return { bookmark: j.bookmark, source: 'agent', path: j.path };
    }
  } catch {
    /* none */
  }
  return { bookmark: null, source: 'none' };
}

// Electron resolves the bookmark with NSURLBookmarkResolutionWithSecurityScope and throws
// on an NSError or a stale bookmark; startAccessingSecurityScopedResource's BOOL result is
// not exposed, so a silent "no access" shows up only as EPERM on the next file operation.
function startAccess(bookmark: string): () => void {
  const fn = (app as any).startAccessingSecurityScopedResource;
  if (typeof fn !== 'function') {
    throw Object.assign(new Error('app.startAccessingSecurityScopedResource is not a function (non-MAS build)'), { code: 'API_MISSING' });
  }
  try {
    const stop = fn.call(app, bookmark);
    return typeof stop === 'function' ? stop : () => {};
  } catch (err: any) {
    const msg = String(err?.message || err);
    throw Object.assign(new Error(msg), { code: /stale/i.test(msg) ? 'BOOKMARK_STALE' : /NSError/.test(msg) ? 'BOOKMARK_RESOLVE_ERROR' : 'BOOKMARK_ERROR' });
  }
}

// ---------- renderer helpers ----------

let mainWindow: BrowserWindow | null = null;

async function waitForMainWindow(timeoutMs: number): Promise<BrowserWindow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (win) {
      if (win.webContents.isLoading()) {
        await withTimeout(new Promise<void>(resolve => win.webContents.once('did-finish-load', () => resolve())), Math.max(1000, deadline - Date.now()), 'did-finish-load');
      }
      return win;
    }
    await sleep(250);
  }
  const e: any = new Error('no main window');
  e.code = 'NO_WINDOW';
  throw e;
}

const wrapBody = (body: string) => `(async () => {
    try {
      const fs = require('fs'); const os = require('os'); const path = require('path');
      const v = await (async () => { ${body} })();
      return { ok: true, value: v };
    } catch (e) {
      return { ok: false, code: String((e && (e.code || e.name)) || 'ERROR'), message: String((e && e.message) || e) };
    }
  })()`;

async function rendererEval(body: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return probeError('NO_WINDOW', 'main window not available');
  }
  const r = await mainWindow.webContents.executeJavaScript(wrapBody(body), true);
  if (!r || !r.ok) {
    return probeError(r?.code || 'ERROR', r?.message || 'no result');
  }
  return r.value;
}

// A renderer process spawned only now: tells a grant copied at spawn time apart from one
// shared live by the whole sandbox.
async function newRendererEval(body: string) {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
  try {
    await win.loadURL('data:text/html,<p>mas-probe</p>');
    const r = await win.webContents.executeJavaScript(wrapBody(body), true);
    const extra = { new_renderer_pid: win.webContents.getOSProcessId(), main_window_renderer_pid: mainWindow?.webContents.getOSProcessId() ?? null };
    return r && r.ok ? { ...extra, value: r.value } : probeError(r?.code || 'ERROR', { ...extra, message: r?.message });
  } finally {
    win.destroy();
  }
}

const rendererRead = (p: string) => rendererEval(`const d = fs.readFileSync(${J(p)}, 'utf8'); return { path: ${J(p)}, bytes: d.length, head: d.slice(0, 60) };`);
const rendererWrite = (p: string, data: string) => rendererEval(`fs.writeFileSync(${J(p)}, ${J(data)}); return { path: ${J(p)}, wrote: ${data.length} };`);

// fs.createWriteStream in the renderer, like request.tsx writeToDownloadPath, but with an
// 'error' handler so a failure is observable.
const rendererWriteStream = (p: string, bytes: number) => rendererEval(`
  const p = ${J(p)};
  const r = await new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const s = fs.createWriteStream(p);
    s.on('error', e => finish({ ok: false, code: e.code || e.name, message: e.message, via: 'error-event' }));
    s.on('finish', () => finish({ ok: true, path: p, bytesWritten: s.bytesWritten }));
    s.end(Buffer.alloc(${bytes}, 120));
    setTimeout(() => finish({ ok: false, code: 'NO_EVENT', message: 'neither finish nor error within 10s', via: 'timeout' }), 10000);
  });
  if (!r.ok) { const e = new Error(r.message + ' [' + r.via + ']'); e.code = r.code; throw e; }
  return r;`);

// Exactly writeToDownloadPath's shape: readStream.pipe(createWriteStream(p)) with no
// 'error' listener on the write stream; it resolves on the READ stream's 'end'.
const rendererPipeNoHandler = (p: string) => rendererEval(`
  const { Readable } = require('stream');
  const p = ${J(p)};
  const seen = [];
  const onUnc = e => seen.push({ via: 'process.uncaughtException', code: e && e.code, message: String(e && e.message) });
  const onWin = ev => { seen.push({ via: 'window.error', message: String(ev.message || (ev.error && ev.error.message)) }); if (ev.preventDefault) ev.preventDefault(); };
  process.on('uncaughtException', onUnc);
  window.addEventListener('error', onWin);
  const to = fs.createWriteStream(p);
  const rs = Readable.from([Buffer.alloc(1024, 120)]);
  let readEnd = false;
  rs.on('end', () => { readEnd = true; });
  rs.pipe(to);
  await new Promise(r => setTimeout(r, 3000));
  process.removeListener('uncaughtException', onUnc);
  window.removeEventListener('error', onWin);
  let stat;
  try { stat = fs.statSync(p).size; } catch (e) { stat = e.code; }
  return { read_stream_end_fired: readEnd, write_stream_destroyed: to.destroyed, unhandled_errors: seen, file_stat: stat };`);

// ---------- main helpers ----------

function mainRead(p: string) {
  const d = fs.readFileSync(p, 'utf8');
  return { path: p, bytes: d.length, head: head(d, 60) };
}

function mainWrite(p: string, data: string) {
  fs.writeFileSync(p, data);
  return { path: p, wrote: data.length, readBack: fs.readFileSync(p, 'utf8') === data };
}

function curlRequest(url: string, opts: [string, any][] = [], caBlob?: string | null): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Curl } = require('@getinsomnia/node-libcurl');
  return new Promise((resolve, reject) => {
    const curl = new Curl();
    curl.setOpt(Curl.option.URL, url);
    // null = no blob (let CAINFO decide); undefined = system roots (like the app's fallback)
    if (caBlob !== null) {
      curl.setOpt(Curl.option.CAINFO_BLOB, caBlob ?? tls.rootCertificates.join('\n'));
    }
    curl.setOpt(Curl.option.TIMEOUT, 20);
    try {
      // keep a CA store loaded by one request from masking a later unreadable CAINFO
      curl.setOpt('CA_CACHE_TIMEOUT', 0);
    } catch {
      /* option unknown to this libcurl */
    }
    for (const [k, v] of opts) {
      curl.setOpt(k, v);
    }
    curl.on('end', (status: number, data: any) => {
      curl.close();
      resolve({ status, body: head(String(data), 300) });
    });
    curl.on('error', (err: any, code: number) => {
      curl.close();
      reject(Object.assign(new Error(err?.message || String(err)), { code: `CURLE_${code}` }));
    });
    curl.perform();
  });
}

function spawnResult(r: ReturnType<typeof spawnSync>, okWhen: (stdout: string) => boolean) {
  const stdout = String(r.stdout ?? '');
  const stderr = String(r.stderr ?? '');
  const detail = {
    status: r.status,
    signal: r.signal,
    spawn_error: r.error ? `${(r.error as any).code || ''} ${r.error.message}` : null,
    stdout: head(stdout, 300),
    stderr: head(stderr, 600),
  };
  if (r.error) {
    return probeError(String((r.error as any).code || 'SPAWN_ERROR'), detail);
  }
  if (r.signal) {
    return probeError(`SIGNAL_${r.signal}`, detail);
  }
  if (r.status !== 0 || !okWhen(stdout)) {
    return probeError(`EXIT_${r.status}`, detail);
  }
  return detail;
}

// ---------- shared check groups ----------

async function envCheck() {
  await check('env', 'main', 'userData/HOME under ~/Library/Containers/com.insomnium.app/Data (process_mas is informational only)', () => {
    const userData = app.getPath('userData');
    return {
      process_mas: (process as any).mas ?? null,
      start_accessing_security_scoped_resource: typeof (app as any).startAccessingSecurityScopedResource,
      electron: process.versions.electron,
      os_release: os.release(),
      bundle_version: bundleVersion(),
      app_version: app.getVersion(),
      exec_path: process.execPath,
      user_data: userData,
      user_data_in_container: userData.includes('/Library/Containers/'),
      app_home: app.getPath('home'),
      os_homedir: os.homedir(),
      userinfo_homedir: os.userInfo().homedir,
      temp: app.getPath('temp'),
      documents: app.getPath('documents'),
      env: {
        HOME: process.env.HOME ?? null,
        TMPDIR: process.env.TMPDIR ?? null,
        CFFIXED_USER_HOME: process.env.CFFIXED_USER_HOME ?? null,
        APP_SANDBOX_CONTAINER_ID: process.env.APP_SANDBOX_CONTAINER_ID ?? null,
      },
      real_home: realHome,
      pid: process.pid,
      ppid: process.ppid,
      argv: process.argv,
    };
  });
}

async function rendererReady() {
  await check('renderer-ready', 'main', 'ok (renderer helper starts)', async () => {
    mainWindow = await waitForMainWindow(90000);
    return { url: mainWindow.webContents.getURL(), loading: mainWindow.webContents.isLoading(), renderer_pid: mainWindow.webContents.getOSProcessId() };
  }, 100000);
  await check('renderer-env', 'renderer', 'HOME = container', () => rendererEval(`return {
    type: process.type, mas: process.mas === undefined ? null : process.mas,
    os_homedir: os.homedir(), HOME: process.env.HOME || null, TMPDIR: process.env.TMPDIR || null, pid: process.pid,
    has_require: typeof require === 'function' };`));
}

// Single-file open dialog grant: main, the existing renderer, and a renderer spawned later.
async function openFileGrantChecks(prefix: string, file: string) {
  let opened: string | null = null;
  await check(`${prefix}dialog-open`, 'main', 'ok; bookmarks[0] non-empty (MAS only)', async () => {
    const r = await openDriven(`${prefix}dialog-open`, 'goto', file, { defaultPath: path.dirname(file), properties: ['openFile'] });
    opened = r.filePaths?.[0] || null;
    const bookmark = r.bookmarks?.[0] || null;
    await saveBookmark(`${prefix}open`, bookmark, opened);
    const detail = { canceled: r.canceled, filePaths: r.filePaths, bookmarks_len: Array.isArray(r.bookmarks) ? r.bookmarks.length : null, bookmark0_chars: bookmark ? bookmark.length : 0 };
    return r.canceled || !opened ? probeError('CANCELED', detail) : detail;
  }, 150000);
  const p = opened || file;
  await check(`${prefix}dialog-open-main-read`, 'main', 'ok (PowerBox grant)', () => mainRead(p));
  await check(`${prefix}dialog-open-renderer-read`, 'renderer', 'research said EPERM; round 1 (26): ok, the grant is shared live', () => rendererRead(p));
  await check(`${prefix}dialog-open-new-renderer-read`, 'renderer', 'round 1 (26): ok', () => newRendererEval(`const d = fs.readFileSync(${J(p)}, 'utf8'); return { bytes: d.length };`));
  return p;
}

async function saveFileGrantChecks(prefix: string, file: string) {
  let saved: string | null = null;
  await check(`${prefix}dialog-save`, 'main', 'ok; bookmark non-empty (MAS only)', async () => {
    const r = await saveDriven(`${prefix}dialog-save`, 'default', file, { defaultPath: file });
    saved = r.filePath || null;
    await saveBookmark(`${prefix}save`, r.bookmark, saved);
    const detail = { canceled: r.canceled, filePath: r.filePath, bookmark_chars: r.bookmark ? r.bookmark.length : 0 };
    return r.canceled || !saved ? probeError('CANCELED', detail) : detail;
  }, 150000);
  const p = saved || file;
  await check(`${prefix}dialog-save-renderer-write`, 'renderer', 'research said EPERM; round 1 (26): ok', () => rendererWrite(p, `renderer ${Date.now()}\n`));
  await check(`${prefix}dialog-save-main-write`, 'main', 'ok (PowerBox grant)', () => mainWrite(p, `main ${Date.now()}\n`));
  await check(`${prefix}dialog-save-renderer-read-after-main-write`, 'renderer', 'round 1 (26): ok', () => rendererRead(p));
  await check(`${prefix}dialog-save-main-write-sibling`, 'main', 'EPERM (grant covers the chosen file only)', () =>
    mainWrite(path.join(path.dirname(p), `${path.basename(p, '.txt')}-sibling.txt`), 'sibling'));
}

// The app group write runs off the main thread (fs.promises) so a TCC prompt cannot
// freeze the event loop and the check timeout still fires.
async function appGroupCheck(id: string) {
  await check(id, 'main', 'ok with a team-signed build; ad-hoc: containermanagerd REJECTS the group (round 1 exec\'d instance still wrote it)', async () => {
    const data = `group ${phase}${TAG} ${Date.now()}`;
    await fs.promises.mkdir(path.dirname(groupFile), { recursive: true }).catch(() => null);
    await fs.promises.writeFile(groupFile, data);
    return { path: groupFile, wrote: data.length, readBack: (await fs.promises.readFile(groupFile, 'utf8')) === data };
  }, 20000);
}

async function protocolChecks(suffix: string) {
  await check(`url-handler-registration${suffix}`, 'main', 'round 1 (26) MAS: setAsDefaultProtocolClient=false, isDefaultProtocolClient=true', async () => {
    const set = app.setAsDefaultProtocolClient('insomnia');
    const isDefault = app.isDefaultProtocolClient('insomnia');
    const name = app.getApplicationNameForProtocol('insomnia://');
    let info: any = null;
    try {
      const i: any = await withTimeout(app.getApplicationInfoForProtocol('insomnia://'), 10000, 'getApplicationInfoForProtocol');
      info = { name: i?.name ?? null, path: i?.path ?? null };
    } catch (err: any) {
      info = { error: String(err?.message || err) };
    }
    const host = await agent('/ls-handler').catch((err: any) => ({ error: String(err?.message) }));
    return { setAsDefaultProtocolClient: set, isDefaultProtocolClient: isDefault, applicationNameForProtocol: name, applicationInfoForProtocol: info, host_ls_handler: host, exec_path: process.execPath };
  });
  await rendererEval(`if (!window.__masProbeShellOpen) { window.__masProbeShellOpen = []; require('electron').ipcRenderer.on('shell:open', (_e, u) => window.__masProbeShellOpen.push(String(u))); } return true;`);
  await check(`url-open-while-running${suffix}`, 'main', 'open-url fires with the URL; the app forwards it to the renderer as shell:open', async () => {
    const url = `insomnia://app/probe?x=1&phase=${phase}${TAG}`;
    const before = openUrls().length;
    const host = await agent(`/open-url?url=${encodeURIComponent(url)}`, { timeoutMs: 40000 });
    const got = await waitFor(() => openUrls().slice(before).find(u => u.url === url), 15000);
    await sleep(1000);
    const renderer = await rendererEval('return window.__masProbeShellOpen || null;');
    const detail = { url, host, received: got || null, all_open_urls: openUrls(), renderer_shell_open: renderer };
    return got ? detail : probeError('NO_OPEN_URL_EVENT', detail);
  }, 60000);
}

// ---------- round-2 probes ----------

// Probe 1: openDirectory grant on ~/Documents/probe-dir.
async function directoryProbe() {
  const d = probeDirFx;
  await check('dir-pre-main-readdir', 'main', 'EPERM (no grant yet)', () => ({ entries: fs.readdirSync(d) }));
  await check('dir-pre-renderer-readdir', 'renderer', 'EPERM (no grant yet)', () => rendererEval(`return { entries: fs.readdirSync(${J(d)}) };`));
  await check('dir-dialog-open', 'main', 'ok; chosen == ~/Documents/probe-dir; bookmark (MAS only)', async () => {
    const r = await openDriven('dir-dialog-open', 'goto', `${d}/`, { defaultPath: d, properties: ['openDirectory', 'createDirectory'] });
    const chosen = r.filePaths?.[0] || null;
    await saveBookmark('dir', r.bookmarks?.[0], chosen);
    const detail = { canceled: r.canceled, filePaths: r.filePaths, bookmark_chars: r.bookmarks?.[0]?.length || 0 };
    if (r.canceled || !chosen) {
      return probeError('CANCELED', detail);
    }
    return chosen === d ? detail : probeError('WRONG_SELECTION', detail);
  }, 150000);
  await check('dir-grant-scope-parent-readdir', 'main', 'EPERM (the grant covers probe-dir, not ~/Documents)', () => ({ entries: fs.readdirSync(docs) }));
  await check('dir-renderer-recursive-readdir', 'renderer', 'ok if the grant is shared with the renderer', () =>
    rendererEval(`return { entries: fs.readdirSync(${J(d)}, { recursive: true }).map(String).sort() };`));
  await check('dir-renderer-read-nested', 'renderer', 'ok', () => rendererRead(path.join(d, 'sub1', 'sub2', 'deep.txt')));
  await check('dir-renderer-create-file', 'renderer', 'ok (read-write grant)', () => rendererWrite(path.join(d, 'created-by-renderer.txt'), 'renderer'));
  await check('dir-renderer-mkdir', 'renderer', 'ok', () => rendererEval(`const p = ${J(path.join(d, 'renderer-subdir'))};
    fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'inside.txt'), 'r'); return { dir: p, entries: fs.readdirSync(p) };`));
  await check('dir-main-recursive-readdir', 'main', 'ok', () => ({ entries: (fs.readdirSync(d, { recursive: true }) as any[]).map(String).sort() }));
  await check('dir-main-read-nested', 'main', 'ok', () => mainRead(path.join(d, 'sub1', 'sub2', 'deep.txt')));
  await check('dir-main-create-file', 'main', 'ok', () => mainWrite(path.join(d, 'created-by-main.txt'), 'main'));
  await check('dir-main-mkdir', 'main', 'ok', () => {
    const p = path.join(d, 'main-subdir');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'inside.txt'), 'm');
    return { dir: p, entries: fs.readdirSync(p) };
  });
  await check('dir-new-renderer-readdir', 'renderer', 'ok (renderer spawned after the grant)', () =>
    newRendererEval(`return { entries: fs.readdirSync(${J(d)}, { recursive: true }).length };`));
  await snapshot('p1-after-dir-grant');
}

// Probe 2: .proto imports of a sibling. @grpc/proto-loader is what the app uses both in the
// renderer (proto-loader.tsx validateProtoFile, at import time) and in main (grpc.ts).
async function protoProbe() {
  const plPath = require.resolve('@grpc/proto-loader');
  const mainLoad = (file: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pl = require('@grpc/proto-loader');
    return pl.load(file, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [path.dirname(file)] })
      .then((def: any) => ({ types: Object.keys(def).sort() }));
  };
  const rendererLoad = (file: string) => rendererEval(`const pl = require(${J(plPath)});
    const d = await pl.load(${J(file)}, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [${J(path.dirname(file))}] });
    return { types: Object.keys(d).sort() };`);

  await check('proto-dialog-open-a', 'main', 'ok (single-file grant for a.proto)', async () => {
    const r = await openDriven('proto-dialog-open-a', 'goto', protoA, { defaultPath: protosDir, properties: ['openFile'] });
    const detail = { canceled: r.canceled, filePaths: r.filePaths };
    return r.filePaths?.[0] === protoA ? detail : probeError(r.canceled ? 'CANCELED' : 'WRONG_SELECTION', detail);
  }, 150000);
  await check('proto-main-read-a', 'main', 'ok', () => mainRead(protoA));
  await check('proto-main-read-b-sibling', 'main', 'EPERM (sibling not granted)', () => mainRead(protoB));
  await check('proto-renderer-read-b-sibling', 'renderer', 'EPERM', () => rendererRead(protoB));
  await check('proto-loader-main-single-file-grant', 'main', 'error: import "b.proto" unreadable', () => mainLoad(protoA));
  await check('proto-loader-renderer-single-file-grant', 'renderer', 'error: import "b.proto" unreadable', () => rendererLoad(protoA));
  await check('proto-dialog-open-dir', 'main', 'ok; chosen == ~/Documents/protos', async () => {
    const r = await openDriven('proto-dialog-open-dir', 'goto', `${protosDir}/`, { defaultPath: protosDir, properties: ['openDirectory'] });
    const detail = { canceled: r.canceled, filePaths: r.filePaths };
    return r.filePaths?.[0] === protosDir ? detail : probeError(r.canceled ? 'CANCELED' : 'WRONG_SELECTION', detail);
  }, 150000);
  await check('proto-main-read-b-after-dir-grant', 'main', 'ok', () => mainRead(protoB));
  await check('proto-loader-main-after-dir-grant', 'main', 'ok (types include probe.B, probe.ProbeService)', () => mainLoad(protoA));
  await check('proto-loader-renderer-after-dir-grant', 'renderer', 'ok', () => rendererLoad(protoA));
}

// Probe 6: client certificates through libcurl against a TLS server that requires one.
type CertMode = 'paths' | 'certkey-cablob' | 'nocert-cablob' | 'app-like';

async function certRequest(label: string, mode: CertMode) {
  const url = `https://127.0.0.1:${TLS_PORT}/${label}${TAG}`;
  const opts: [string, any][] = [];
  let ca: string | null = null;
  if (mode === 'paths') {
    opts.push(['CAINFO', caPath]);
  } else if (mode === 'app-like') {
    // like main/network/curl.ts: main reads the CA file itself, libcurl gets CAINFO_BLOB
    ca = fs.readFileSync(caPath, 'utf8');
  } else {
    if (!caPemFromEnv) {
      return probeError('NO_CA_ENV', 'INSOMNIUM_MAS_PROBE_CA_B64 not set');
    }
    ca = caPemFromEnv;
  }
  if (mode !== 'nocert-cablob') {
    opts.push(['SSLCERT', certPath], ['SSLCERTTYPE', 'PEM'], ['SSLKEY', keyPath]);
  }
  const before = await agent('/tls-log').then(j => j.count).catch(() => 0);
  let res: any = null;
  let err: any = null;
  try {
    res = await curlRequest(url, opts, ca);
  } catch (e) {
    err = e;
  }
  await sleep(300);
  const server = await agent(`/tls-log?since=${before}`).then(j => j.entries).catch((e: any) => ({ error: String(e?.message) }));
  if (err) {
    return probeError(err.code || 'ERROR', { mode, message: err.message, server });
  }
  let body: any = res.body;
  try {
    body = JSON.parse(res.body);
  } catch {
    /* text */
  }
  const detail = { mode, status: res.status, body, server };
  if (mode !== 'nocert-cablob' && body?.client_cn !== CLIENT_CN) {
    return probeError('SERVER_SAW_NO_CLIENT_CERT', detail);
  }
  return detail;
}

async function certProbe() {
  await check('cert-server-requires-client-cert', 'main', 'error in BOTH flavors (negative control: the server rejects a handshake without a client cert)', () => certRequest('nocert', 'nocert-cablob'));
  await check('cert-nogrant-libcurl-paths', 'main', 'MAS: error (libcurl cannot open CAINFO/SSLCERT/SSLKEY)', () => certRequest('nogrant-paths', 'paths'));
  await check('cert-nogrant-certkey-cablob', 'main', 'MAS: CURLE_58 (client cert/key unreadable; CA passed as a blob)', () => certRequest('nogrant-certkey', 'certkey-cablob'));
  await check('cert-nogrant-app-like', 'main', 'MAS: EPERM (main cannot read the CA file)', () => certRequest('nogrant-app-like', 'app-like'));

  const got: Record<string, string> = {};
  const want = [caPath, certPath, keyPath];
  await check('cert-dialog-multi', 'main', 'ok; ca.crt, client.crt, client.key chosen in one multi-select dialog', async () => {
    const r = await openDriven('cert-dialog-multi', 'goto-selectall', `${certsDir}/`, { defaultPath: certsDir, properties: ['openFile', 'multiSelections'] });
    (r.filePaths || []).forEach((p: string, i: number) => {
      got[p] = r.bookmarks?.[i] || '';
    });
    const detail = { canceled: r.canceled, filePaths: r.filePaths, bookmarks_len: Array.isArray(r.bookmarks) ? r.bookmarks.length : null };
    return want.every(w => w in got) ? detail : probeError(r.canceled ? 'CANCELED' : 'PARTIAL_SELECTION', detail);
  }, 150000);
  for (const w of want) {
    if (w in got) {
      continue;
    }
    await check(`cert-dialog-single-${path.basename(w)}`, 'main', 'ok (fallback single-file dialog)', async () => {
      const r = await openDriven(`cert-dialog-${path.basename(w)}`, 'goto', w, { defaultPath: certsDir, properties: ['openFile'] });
      if (r.filePaths?.[0]) {
        got[r.filePaths[0]] = r.bookmarks?.[0] || '';
      }
      const detail = { canceled: r.canceled, filePaths: r.filePaths };
      return r.filePaths?.[0] === w ? detail : probeError(r.canceled ? 'CANCELED' : 'WRONG_SELECTION', detail);
    }, 150000);
  }
  await saveBookmark('cert-ca', got[caPath], caPath);
  await saveBookmark('cert-cert', got[certPath], certPath);
  await saveBookmark('cert-key', got[keyPath], keyPath);
  await check('cert-granted-libcurl-paths', 'main', 'ok; the server saw CN=mas-probe-client', () => certRequest('granted-paths', 'paths'));
  await check('cert-granted-app-like', 'main', 'ok (main reads the CA like curl.ts; libcurl reads cert/key)', () => certRequest('granted-app-like', 'app-like'));
  await check('cert-granted-renderer-read-key', 'renderer', 'ok if the grant is shared with the renderer', () => rendererRead(keyPath));
}

// Probe 6 (iii) / probe 4: client certs via bookmarks after a relaunch or an update.
async function certBookmarkChecks(prefix: string) {
  await check(`${prefix}-cert-nobookmark-paths`, 'main', 'MAS: error (no grant after relaunch)', () => certRequest(`${prefix}-nobookmark`, 'paths'));
  const stops: (() => void)[] = [];
  await check(`${prefix}-cert-bookmarks-start`, 'main', 'ok (3 bookmarks resolve and start)', async () => {
    const res: Record<string, string> = {};
    for (const name of ['cert-ca', 'cert-cert', 'cert-key']) {
      const b = await loadBookmark(name);
      if (!b.bookmark) {
        res[name] = `NO_BOOKMARK (${b.source})`;
        continue;
      }
      try {
        stops.push(startAccess(b.bookmark));
        res[name] = `started (${b.source})`;
      } catch (err: any) {
        res[name] = `${err?.code}: ${head(String(err?.message), 400)}`;
      }
    }
    return stops.length === 3 ? res : probeError(stops.length ? 'PARTIAL' : 'NONE_STARTED', res);
  });
  await check(`${prefix}-cert-bookmarks-libcurl-paths`, 'main', 'ok while main holds access; the server saw the client cert', () => certRequest(`${prefix}-bookmarks`, 'paths'));
  stops.forEach(s => s());
  await check(`${prefix}-cert-after-stop-paths`, 'main', 'MAS: error again after stopAccessing', () => certRequest(`${prefix}-after-stop`, 'paths'));
}

// Probe 5: Unix-socket requests to sockets outside the container.
async function unixSocketProbe() {
  for (const [label, sock] of SOCKETS) {
    // Insomnium's http://unix:/path:/rest form, split the way network.ts transformUrl does
    const m = `http://unix:${sock}:/probe/libcurl-${label}`.match(/(https?:)\/\/unix:?(\/[^:]+):\/(.+)/);
    const finalUrl = m ? `${m[1]}//${m[3]}` : '';
    const socketPath = m ? m[2] : sock;
    await check(`unix-socket-libcurl-${label}`, 'main', 'MAS: error (connect to a socket outside the container denied); control: ok', () =>
      curlRequest(finalUrl, [['UNIX_SOCKET_PATH', socketPath]]).then(r => ({ ...r, final_url: finalUrl, socket_path: socketPath })));
    await check(`unix-socket-node-main-${label}`, 'main', 'same as libcurl', () => httpRequest(`http://localhost/node-main-${label}`, { socketPath: sock, timeoutMs: 10000 }));
    await check(`unix-socket-node-renderer-${label}`, 'renderer', 'same as libcurl', () => rendererEval(`const http = require('http');
      return await new Promise((resolve, reject) => {
        const req = http.request({ socketPath: ${J(sock)}, path: '/node-renderer-${label}' }, res => {
          let b = ''; res.on('data', c => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 200) }));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { const e = new Error('timeout'); e.code = 'ETIMEDOUT'; req.destroy(e); });
        req.end();
      });`));
  }
}

async function crashControls() {
  // Positive controls for crash-report collection: the script must find .ips reports for these.
  await check('crash-positive-control-renderer', 'renderer', 'renderer crashes via process.crash() (render-process-gone); the script must find its .ips', async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    await win.loadURL('data:text/html,<p>crash-control</p>');
    const pid = win.webContents.getOSProcessId();
    const gone = new Promise<any>(resolve => win.webContents.once('render-process-gone', (_e, d) => resolve(d)));
    win.webContents.executeJavaScript('setTimeout(() => process.crash(), 100); 1', true).catch(() => null);
    const d = await withTimeout(gone, 15000, 'render-process-gone');
    win.destroy();
    await agentQuiet(`/crash-control?kind=renderer&pid=${pid}`);
    return { pid, details: d };
  }, 25000);
  await check('crash-positive-control-child', 'main', 'ELECTRON_RUN_AS_NODE child aborts (SIGABRT); the script must find its .ips', async () => {
    // writeSync: stdout to a pipe is asynchronous on macOS and abort() would drop it
    const r = spawnSync(process.execPath, ['-e', 'require("fs").writeSync(1, process.pid + "\\n"); process.abort()'], { env: { ELECTRON_RUN_AS_NODE: '1' }, timeout: 20000, encoding: 'utf8' });
    const pid = parseInt(String(r.stdout || '').trim(), 10) || null;
    await agentQuiet(`/crash-control?kind=child&pid=${pid}`);
    return { pid, status: r.status, signal: r.signal };
  }, 30000);
}

// ---------- phases ----------

async function phase1() {
  await envCheck();
  await rendererReady();
  await snapshot('p1-start');

  // --- FS, no dialog (round 1) ---
  const udFile = path.join(app.getPath('userData'), 'mas-probe', 'fs-main.txt');
  await check('fs-userdata-rw', 'main', 'ok', () => mainWrite(udFile, `main ${Date.now()}`));
  await check('fs-temp-rw', 'main', 'ok (container tmp)', () => mainWrite(path.join(app.getPath('temp'), `mas-probe-${process.pid}.txt`), 'tmp'));
  await check('fs-etc-ssl-cert', 'main', 'ok (system path readable)', () => mainRead('/etc/ssl/cert.pem'));
  await check('fs-netrc-read', 'main', 'EPERM', () => mainRead(netrcPath));
  await check('fs-documents-direct-read', 'main', 'EPERM', () => mainRead(docsIn));
  await check('fs-plain-home-direct-read', 'main', 'EPERM', () => mainRead(plainFile));
  await check('fs-real-home-write', 'main', 'EPERM', () => mainWrite(path.join(realHome, 'mas-probe-home-write.txt'), 'x'));
  // Code that builds home paths from os.homedir() silently points into the container.
  await check('fs-homedir-relative-netrc', 'main', 'ENOENT (os.homedir() is the container)', () => mainRead(path.join(os.homedir(), '.netrc')));
  await check('fs-gcloud-adc-real-home', 'main', 'EPERM', () => mainRead(path.join(realHome, '.config', 'gcloud', 'application_default_credentials.json')));
  // Container Downloads is a symlink to ~/Downloads, usable only with files.downloads.read-write.
  await check('fs-downloads-write', 'main', 'EPERM (no files.downloads.read-write entitlement)', () => mainWrite(path.join(app.getPath('downloads'), 'mas-probe-download.txt'), 'dl'));

  const udRendererFile = path.join(app.getPath('userData'), 'mas-probe', 'fs-renderer.txt');
  await check('renderer-fs-userdata-rw', 'renderer', 'ok (inherits container)', () => rendererEval(
    `fs.writeFileSync(${J(udRendererFile)}, 'renderer'); return { path: ${J(udRendererFile)}, readBack: fs.readFileSync(${J(udRendererFile)}, 'utf8') };`));
  await check('renderer-fs-etc-ssl-cert', 'renderer', 'ok', () => rendererRead('/etc/ssl/cert.pem'));
  await check('renderer-fs-netrc-read', 'renderer', 'EPERM', () => rendererRead(netrcPath));
  await check('renderer-fs-documents-direct-read', 'renderer', 'EPERM', () => rendererRead(docsIn));

  // --- DIALOGS: open + save (round 1) ---
  const inPath = await openFileGrantChecks('', docsIn);
  await saveFileGrantChecks('', docsOut);
  await snapshot('p1-after-dialogs');
  await appGroupCheck('fs-app-group-container-rw');

  // --- round 2 dialogs ---
  await directoryProbe();
  await protoProbe();
  await certProbe();
  await unixSocketProbe();

  // --- NETWORK (round 1) ---
  await check('net-libcurl-require', 'main', 'ok', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@getinsomnia/node-libcurl');
    return { version: mod.Curl.getVersion?.() ?? null, resolved: require.resolve('@getinsomnia/node-libcurl') };
  });
  await check('net-libcurl-https', 'main', 'ok (network.client)', () => curlRequest('https://example.com/'));
  await check('net-electron-fetch-https', 'main', 'ok (network.client)', async () => {
    const r = await net.fetch('https://example.com/');
    return { status: r.status, bytes: (await r.text()).length };
  });

  let server: http.Server | null = null;
  let port = 0;
  await check('net-http-server-listen', 'main', 'ok (network.server)', async () => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(J({ path: req.url, authorization: req.headers.authorization || null }));
    });
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => resolve());
    });
    server = s;
    port = (s.address() as any).port;
    return { port };
  });
  const base = `http://127.0.0.1:${port}`;
  await check('net-http-loopback-self', 'main', 'ok', async () => (port ? httpRequest(`${base}/self`) : probeError('NO_SERVER', null)));
  await check('net-libcurl-loopback', 'main', 'ok', () => (port ? curlRequest(`${base}/curl`) : probeError('NO_SERVER', null)));
  await check('net-libcurl-netrc-default', 'main', 'no Authorization (libcurl cannot read ~/.netrc)', async () => {
    if (!port) {
      return probeError('NO_SERVER', null);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CurlNetrc } = require('@getinsomnia/node-libcurl');
    const r = await curlRequest(`${base}/netrc-default`, [['NETRC', CurlNetrc.Required]]);
    const got = JSON.parse(r.body.replace(/\.\.\.\(\d+ chars\)$/, '')).authorization;
    return got ? { ...r, authorization: got } : probeError('NO_AUTH_HEADER', { ...r, note: 'libcurl did not apply ~/.netrc' });
  });
  await check('net-libcurl-netrc-explicit-file', 'main', 'no Authorization (file unreadable)', async () => {
    if (!port) {
      return probeError('NO_SERVER', null);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CurlNetrc } = require('@getinsomnia/node-libcurl');
    const r = await curlRequest(`${base}/netrc-file`, [['NETRC', CurlNetrc.Required], ['NETRC_FILE', netrcPath]]);
    const got = JSON.parse(r.body.replace(/\.\.\.\(\d+ chars\)$/, '')).authorization;
    return got ? { ...r, authorization: got } : probeError('NO_AUTH_HEADER', { ...r, note: 'libcurl did not apply NETRC_FILE' });
  });
  await check('net-renderer-fetch-loopback', 'renderer', 'ok', () => (port
    ? rendererEval(`const r = await fetch(${J(`${base}/renderer`)}); return { status: r.status, body: await r.text() };`)
    : probeError('NO_SERVER', null)));

  // --- insomnia:// handler (probe 7) ---
  await protocolChecks('');

  // --- CHILD PROCESSES (round 1) ---
  await check('child-run-as-node', 'main', 'round 1 (26): ok', () =>
    spawnResult(spawnSync(process.execPath, ['-e', 'console.log(1)'], {
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeout: 20000,
      encoding: 'utf8',
    }), s => s.trim() === '1'), 30000);
  const childScript = `const fs = require('fs'), os = require('os');
    const t = p => { try { fs.readFileSync(p); return 'ok'; } catch (e) { return e.code || String(e); } };
    const [netrc, docs, ud] = process.argv.slice(1);
    console.log(JSON.stringify({ one: 1, pid: process.pid, homedir: os.homedir(), HOME: process.env.HOME || null,
      netrc: t(netrc), granted_doc: t(docs), parent_userdata_file: t(ud) }));`;
  await check('child-run-as-node-view', 'main', 'child sandboxed with its own entitlements; parent grant visible? (round 1: see detail)', () => {
    const r = spawnSync(process.execPath, ['-e', childScript, netrcPath, inPath, udFile], {
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeout: 20000,
      encoding: 'utf8',
    });
    const res: any = spawnResult(r, s => s.includes('"one":1'));
    if (res.__probe_error) {
      return res;
    }
    try {
      return { ...JSON.parse(String(r.stdout).trim().split('\n').pop() || '{}'), exit: r.status };
    } catch {
      return res;
    }
  }, 30000);
  await check('child-bin-sh', 'main', 'ok (system binary inherits the sandbox)', () =>
    spawnResult(spawnSync('/bin/sh', ['-c', 'echo sh-ok; id -un'], { timeout: 10000, encoding: 'utf8' }), s => s.includes('sh-ok')));
  const yarnPath = path.resolve(app.getAppPath(), '../bin/yarn-standalone.js');
  await check('child-yarn-version', 'main', 'round 1 (26): ok', () =>
    spawnResult(spawnSync(process.execPath, ['--no-deprecation', yarnPath, '--version'], {
      env: { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: 'true' },
      timeout: 30000,
      encoding: 'utf8',
    }), s => /^\d+\.\d+/.test(s.trim())), 40000);
  const pluginDir = path.join(process.env['INSOMNIA_DATA_PATH'] || app.getPath('userData'), 'plugins', PLUGIN);
  await check('child-plugin-install', 'main', 'round 1 (26): ok (the store edition ships without plugins anyway)', async () => {
    const { default: installPlugin } = await import('./install-plugin');
    await installPlugin(PLUGIN);
    const ok = fs.existsSync(path.join(pluginDir, 'package.json'));
    return ok ? { plugin: PLUGIN, pluginDir, files: fs.readdirSync(pluginDir) } : probeError('NOT_INSTALLED', { plugin: PLUGIN, pluginDir });
  }, 150000);
  await check('child-plugin-load-renderer', 'renderer', 'ok if installed (plugins load from the container)', () => (fs.existsSync(pluginDir)
    ? rendererEval(`const m = require(${J(pluginDir)}); return { exports: Object.keys(m || {}) };`)
    : probeError('NOT_INSTALLED', pluginDir)));

  // --- MCP (round 1) ---
  await check('mcp-server', 'main', 'ok (network.server); discovery file lands in container home', async () => {
    const srv = await import('./mcp/server');
    const disc = await import('./mcp/discovery');
    const { port: mcpPort } = await srv.startMcpServer();
    const file = disc.getDiscoveryFilePath();
    const existsAfterStart = fs.existsSync(file);
    let explicitWrite = 'ok';
    try {
      await disc.writeDiscoveryFile({ port: mcpPort, token: 'mas-probe-dummy-token' });
    } catch (err: any) {
      explicitWrite = `${err?.code || 'ERROR'} ${err?.message}`;
    }
    const health = await httpRequest(`http://127.0.0.1:${mcpPort}/health`);
    const realHomeFile = path.join(realHome, '.insomnium', 'mcp.json');
    let realHomeFileExists: boolean | string = false;
    try {
      realHomeFileExists = fs.existsSync(realHomeFile);
    } catch (err: any) {
      realHomeFileExists = String(err?.code);
    }
    await srv.stopMcpServer();
    const detail = { port: mcpPort, discovery_file: file, exists_after_start: existsAfterStart, explicit_write: explicitWrite, health, real_home_file: realHomeFile, real_home_file_exists: realHomeFileExists };
    return explicitWrite === 'ok' && health.status === 200 ? detail : probeError('MCP_PARTIAL', detail);
  }, 30000);

  await check('env-process-metrics', 'main', 'INFORMATIONAL ONLY: Electron hard-codes sandboxed=true in MAS builds; not sandbox evidence', () => app.getAppMetrics().map(m => ({
    pid: m.pid,
    type: m.type,
    serviceName: (m as any).serviceName ?? null,
    sandboxed_informational: (m as any).sandboxed ?? null,
  })));
  if (server) {
    (server as http.Server).close();
  }
  await crashControls();
}

async function phase2() {
  await envCheck();
  await rendererReady();
  await snapshot('p2-start');
  await check('persist-direct-read', 'main', 'EPERM (no grant after relaunch)', () => mainRead(docsIn));
  await check('persist-renderer-direct-read', 'renderer', 'EPERM (no grant after relaunch)', () => rendererRead(docsIn));
  let stop: (() => void) | null = null;
  await check('persist-bookmark-read', 'main', 'ok (security-scoped bookmark)', async () => {
    const b = await loadBookmark('open');
    if (!b.bookmark) {
      return probeError('NO_BOOKMARK', `phase 1 saved no open-dialog bookmark (${b.source})`);
    }
    stop = startAccess(b.bookmark);
    return { ...mainRead(docsIn), source: b.source };
  });
  // While main holds the bookmark's access open, can the renderer read too?
  await check('persist-renderer-read-during-access', 'renderer', 'round 1 (26): ok (access is visible to the renderer)', () => rendererRead(docsIn));
  await snapshot('p2-bookmark-access-open');
  if (stop) {
    (stop as () => void)();
  }
  await check('persist-renderer-read-after-stop', 'renderer', 'EPERM', () => rendererRead(docsIn));
  await check('persist-direct-read-after-stop', 'main', 'EPERM', () => mainRead(docsIn));
  await check('persist-save-bookmark-write', 'main', 'ok (security-scoped bookmark)', async () => {
    const b = await loadBookmark('save');
    if (!b.bookmark) {
      return probeError('NO_BOOKMARK', `phase 1 saved no save-dialog bookmark (${b.source})`);
    }
    const s = startAccess(b.bookmark);
    try {
      return mainWrite(docsOut, `phase2 ${Date.now()}\n`);
    } finally {
      s();
    }
  });

  // --- probe 3: directory bookmark, Download After Send ---
  let stopDir: (() => void) | null = null;
  await check('p2-dir-direct-list', 'main', 'EPERM (no grant after relaunch)', () => ({ entries: fs.readdirSync(probeDirFx) }));
  await check('p2-dir-bookmark-start', 'main', 'ok (security-scoped directory bookmark)', async () => {
    const b = await loadBookmark('dir');
    if (!b.bookmark) {
      return probeError('NO_BOOKMARK', b.source);
    }
    stopDir = startAccess(b.bookmark);
    return { source: b.source, path: b.path };
  });
  const dl = path.join(probeDirFx, 'download-p2.bin');
  await check('p2-dir-renderer-writestream', 'renderer', 'ok while main holds access (request.tsx writeToDownloadPath shape)', () => rendererWriteStream(dl, 65536));
  await check('p2-dir-main-list', 'main', 'ok; lists download-p2.bin', () => ({ entries: fs.readdirSync(probeDirFx), size: fs.statSync(dl).size }));
  await snapshot('p2-dir-access-open');
  if (stopDir) {
    (stopDir as () => void)();
  }
  await check('p2-dir-renderer-writestream-after-stop', 'renderer', 'EPERM, surfaced on the write stream error event', () => rendererWriteStream(path.join(probeDirFx, 'download-p2-after-stop.bin'), 1024));
  await check('p2-dir-renderer-pipe-no-error-handler', 'renderer', 'informational: what writeToDownloadPath would see after access is gone', () => rendererPipeNoHandler(path.join(probeDirFx, 'download-p2-nohandler.bin')));
  await check('p2-dir-main-list-after-stop', 'main', 'EPERM', () => ({ entries: fs.readdirSync(probeDirFx) }));

  // --- probe 6 (iii): client certs via bookmarks ---
  await certBookmarkChecks('p2');
}

async function phase3() {
  await envCheck();
  await check('relaunch-call', 'main', 'relaunched instance writes relaunched.json', () => {
    const args = process.argv.slice(1).concat([RELAUNCH_FLAG]);
    stage('relaunching', { args });
    app.relaunch({ args });
    return { args };
  });
}

async function relaunched() {
  const info = {
    relaunched: true,
    pid: process.pid,
    ppid: process.ppid,
    argv: process.argv,
    env_INSOMNIUM_MAS_PROBE: process.env.INSOMNIUM_MAS_PROBE ?? null,
    env_INSOMNIUM_MAS_PROBE_PHASE: process.env.INSOMNIUM_MAS_PROBE_PHASE ?? null,
    process_mas: (process as any).mas ?? null,
    user_data: app.getPath('userData'),
    at: new Date().toISOString(),
  };
  fs.mkdirSync(probeDir, { recursive: true });
  fs.writeFileSync(path.join(probeDir, `relaunched${TAG}.json`), J(info, null, 2));
  stage('relaunched-marker-written', info);
  await check('relaunched-marker', 'main', 'ok', () => info);
  try {
    mainWindow = await waitForMainWindow(60000);
  } catch {
    /* snapshot without renderer */
  }
  await snapshot('p3-relaunched');
}

// LaunchServices-launched (open -n): the app is its own responsible process here.
async function phaseLsd() {
  await envCheck();
  await rendererReady();
  await snapshot('lsd-start');
  await appGroupCheck('lsd-fs-app-group-container-rw');
  await check('lsd-fs-documents-direct-read', 'main', 'EPERM', () => mainRead(lsIn));
  await check('lsd-renderer-documents-direct-read', 'renderer', 'EPERM', () => rendererRead(lsIn));
  await openFileGrantChecks('lsd-', lsIn);
  await saveFileGrantChecks('lsd-', lsOut);
  await snapshot('lsd-after-dialogs');
  await protocolChecks('-lsd');
}

async function phaseUrlCold() {
  await envCheck();
  await check('url-cold-open-url', 'main', 'open-url fires with the URL that launched the app', async () => {
    const got = await waitFor(() => openUrls().find(u => String(u.url).includes('cold=1')), 20000);
    const detail = { received: got || null, all_open_urls: openUrls(), argv: process.argv, exec_path: process.execPath };
    return got ? detail : probeError('NO_OPEN_URL_EVENT', detail);
  }, 25000);
  await check('url-cold-handler-registration', 'main', 'informational', () => ({
    isDefaultProtocolClient: app.isDefaultProtocolClient('insomnia'),
    applicationNameForProtocol: app.getApplicationNameForProtocol('insomnia://'),
  }));
}

// After a simulated update: same bundle id, new CFBundleVersion, re-signed (ad-hoc: new cdhash).
async function phase4() {
  await envCheck();
  await check('upd-identity', 'main', 'informational: CFBundleVersion bumped and re-signed by the test script', async () => ({
    bundle_version: bundleVersion(),
    host: await agent('/update-info').catch((e: any) => ({ error: String(e?.message) })),
  }));
  await rendererReady();
  await snapshot('p4-start');
  await check('upd-userdata-rw', 'main', 'ok (same container after the update)', () => mainWrite(path.join(probeDir, 'p4-write.txt'), `p4 ${Date.now()}`));
  await check('upd-bookmark-files-in-userdata', 'main', 'phase 1 bookmark JSON files still in userData', () => ({ files: fs.readdirSync(probeDir).filter(f => f.startsWith('bookmark-')).sort() }));
  await check('upd-direct-read', 'main', 'EPERM', () => mainRead(docsIn));
  const targets: [string, string, 'file' | 'dir'][] = [['open', docsIn, 'file'], ['save', docsOut, 'file'], ['dir', probeDirFx, 'dir']];
  for (const [name, target, kind] of targets) {
    await check(`upd-bookmark-${name}`, 'main', 'resolves + grants after the update? (ad-hoc identity is cdhash-based: may not predict team-signed behaviour)', async () => {
      const b = await loadBookmark(name);
      if (!b.bookmark) {
        return probeError('NO_BOOKMARK', b.source);
      }
      const s = startAccess(b.bookmark);
      try {
        const r = kind === 'dir' ? { entries: fs.readdirSync(target) } : mainRead(target);
        const renderer = name === 'open' ? await rendererRead(target) : undefined;
        return { source: b.source, ...r, renderer_during_access: renderer };
      } finally {
        s();
      }
    });
  }
  await certBookmarkChecks('p4');
}

export async function runMasProbe() {
  probeDir = path.join(app.getPath('userData'), 'mas-probe');
  app.on('render-process-gone', (_e, _wc, details) => {
    processGone.push({ kind: 'render', ...details, at: new Date().toISOString() });
    out(`MASPROBE:PROCESS-GONE render ${J(details)}`);
  });
  app.on('child-process-gone', (_e, details) => {
    processGone.push({ kind: 'child', ...details, at: new Date().toISOString() });
    out(`MASPROBE:PROCESS-GONE child ${J(details)}`);
  });
  stage('start', { phase, tag: TAG, pid: process.pid, userData: app.getPath('userData') });
  agentQuiet(`/stage?name=start&phase=${encodeURIComponent(phase + TAG)}&pid=${process.pid}`);

  // Whole-probe watchdog so a stuck check still produces a report and exits.
  const watchdogMs = phase === '1' ? 900000 : 300000;
  const watchdog = setTimeout(() => {
    flush({ watchdog: 'fired' });
    out('MASPROBE:WATCHDOG fired');
    agentQuiet(`/report?name=${encodeURIComponent(`phase${phase}${TAG}`)}`, { method: 'POST', body: buildReport({ watchdog: 'fired' }) })
      .finally(() => app.exit(4));
  }, watchdogMs);

  if (phase === 'relaunched') {
    await relaunched();
  } else if (phase === '1') {
    await phase1();
  } else if (phase === '2') {
    await phase2();
  } else if (phase === '3') {
    await phase3();
  } else if (phase === 'lsd') {
    await phaseLsd();
  } else if (phase === 'url-cold') {
    await phaseUrlCold();
  } else if (phase === '4') {
    await phase4();
  }
  clearTimeout(watchdog);
  const report = buildReport({ finished: true });
  flush({ finished: true });
  out('MASPROBE:REPORT-BEGIN');
  out(J(report));
  out('MASPROBE:REPORT-END');
  out(`MASPROBE:REPORT-PATH ${path.join(probeDir, `probe-report-phase${phase}${TAG}.json`)}`);
  await agentQuiet(`/report?name=${encodeURIComponent(`phase${phase}${TAG}`)}`, { method: 'POST', body: report, timeoutMs: 15000 });
  stage('done');
  setTimeout(() => app.exit(0), phase === 'relaunched' ? 1000 : 500);
}
