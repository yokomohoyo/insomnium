// SPIKE ONLY (branch spike/mas-sandbox, never merge).
//
// Empirical Mac App Store sandbox probe. Runs only when INSOMNIUM_MAS_PROBE=1
// (or in the instance started by the probe's own app.relaunch()). Each check is
// recorded as {id, where, expect_mas, result, error_code, detail} and the report
// is written to <userData>/mas-probe/probe-report-phase<N>.json after every check
// (so a kill still leaves a partial report) and printed to stdout at the end
// between MASPROBE:REPORT-BEGIN / MASPROBE:REPORT-END.
//
// Phases (INSOMNIUM_MAS_PROBE_PHASE):
//   1  env, fs, dialogs (driven by the test script), network, child processes, MCP
//   2  persistence: direct read vs security-scoped bookmark read, no dialog
//   3  app.relaunch(); the relaunched instance writes relaunched.json and exits

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

import { app, BrowserWindow, dialog, net } from 'electron';

type Where = 'main' | 'renderer';

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
const checks: Check[] = [];
const processGone: any[] = [];
const startedAt = new Date().toISOString();
const realHome = process.env.INSOMNIUM_MAS_PROBE_REAL_HOME || os.userInfo().homedir;
const docsIn = path.join(realHome, 'Documents', 'probe-in.txt');
const docsOut = path.join(realHome, 'Documents', 'probe-out.txt');
const plainFile = path.join(realHome, 'mas-probe-plain', 'probe-plain.txt');
const netrcPath = path.join(realHome, '.netrc');
// Tiny, dependency-free and not deprecated on npm (a deprecated one makes
// `yarn info` print a warning, which install-plugin.ts treats as failure).
const PLUGIN = 'insomnia-plugin-jsonc';
// Optional report-name suffix, e.g. "-ls" for the LaunchServices-launched run.
const TAG = process.env.INSOMNIUM_MAS_PROBE_TAG ? `-${process.env.INSOMNIUM_MAS_PROBE_TAG}` : '';

let probeDir = '';

function out(line: string) {
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    /* stdout closed */
  }
}

function stage(name: string, extra?: any) {
  out(`MASPROBE:STAGE ${name}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`);
}

function probeError(code: string, detail: any) {
  return { __probe_error: true, code, detail };
}

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

function buildReport(extra: Record<string, any> = {}) {
  return {
    probe: 'insomnium-mas-sandbox-spike',
    phase,
    process_mas: (process as any).mas ?? null,
    pid: process.pid,
    started_at: startedAt,
    written_at: new Date().toISOString(),
    real_home: realHome,
    user_data: app.getPath('userData'),
    checks,
    process_gone: processGone,
    ...extra,
  };
}

function flush(extra: Record<string, any> = {}) {
  try {
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, `probe-report-phase${phase}${TAG}.json`), JSON.stringify(buildReport(extra), null, 2));
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
  out(`MASPROBE:CHECK ${JSON.stringify(entry)}`);
  flush();
  return entry;
}

function head(s: string, n = 120) {
  return s.length > n ? `${s.slice(0, n)}...(${s.length} chars)` : s;
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
    await new Promise(r => setTimeout(r, 250));
  }
  const e: any = new Error('no main window');
  e.code = 'NO_WINDOW';
  throw e;
}

async function rendererEval(body: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return probeError('NO_WINDOW', 'main window not available');
  }
  const code = `(async () => {
    try {
      const fs = require('fs'); const os = require('os'); const path = require('path');
      const v = await (async () => { ${body} })();
      return { ok: true, value: v };
    } catch (e) {
      return { ok: false, code: String((e && (e.code || e.name)) || 'ERROR'), message: String((e && e.message) || e) };
    }
  })()`;
  const r = await mainWindow.webContents.executeJavaScript(code, true);
  if (!r || !r.ok) {
    return probeError(r?.code || 'ERROR', r?.message || 'no result');
  }
  return r.value;
}

const rendererRead = (p: string) => rendererEval(`const d = fs.readFileSync(${JSON.stringify(p)}, 'utf8'); return { path: ${JSON.stringify(p)}, bytes: d.length, head: d.slice(0, 60) };`);
const rendererWrite = (p: string, data: string) => rendererEval(`fs.writeFileSync(${JSON.stringify(p)}, ${JSON.stringify(data)}); return { path: ${JSON.stringify(p)}, wrote: ${data.length} };`);

// ---------- main helpers ----------

function mainRead(p: string) {
  const d = fs.readFileSync(p, 'utf8');
  return { path: p, bytes: d.length, head: head(d, 60) };
}

function mainWrite(p: string, data: string) {
  fs.writeFileSync(p, data);
  return { path: p, wrote: data.length, readBack: fs.readFileSync(p, 'utf8') === data };
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(Object.assign(new Error('http timeout'), { code: 'ETIMEDOUT' })));
  });
}

function curlRequest(url: string, opts: [string, any][] = []): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Curl } = require('@getinsomnia/node-libcurl');
  return new Promise((resolve, reject) => {
    const curl = new Curl();
    curl.setOpt(Curl.option.URL, url);
    curl.setOpt(Curl.option.CAINFO_BLOB, tls.rootCertificates.join('\n'));
    curl.setOpt(Curl.option.TIMEOUT, 20);
    for (const [k, v] of opts) {
      curl.setOpt(k, v);
    }
    curl.on('end', (status: number, data: any) => {
      curl.close();
      resolve({ status, body: head(String(data), 200) });
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

function loadBookmark(name: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(probeDir, `bookmark-${name}.json`), 'utf8'));
    return j.bookmark || null;
  } catch {
    return null;
  }
}

function saveBookmark(name: string, bookmark: string | undefined | null, forPath: string | undefined | null) {
  fs.mkdirSync(probeDir, { recursive: true });
  fs.writeFileSync(path.join(probeDir, `bookmark-${name}.json`), JSON.stringify({ bookmark: bookmark || null, path: forPath || null }));
}

async function envCheck() {
  await check('env', 'main', 'process.mas=true; userData under ~/Library/Containers/com.insomnium.app/Data', () => {
    const userData = app.getPath('userData');
    return {
      process_mas: (process as any).mas ?? null,
      process_sandboxed: (process as any).sandboxed ?? null,
      start_accessing_security_scoped_resource: typeof (app as any).startAccessingSecurityScopedResource,
      electron: process.versions.electron,
      exec_path: process.execPath,
      user_data: userData,
      user_data_in_container: userData.includes('/Library/Containers/'),
      app_home: app.getPath('home'),
      os_homedir: os.homedir(),
      userinfo_homedir: os.userInfo().homedir,
      temp: app.getPath('temp'),
      app_data: app.getPath('appData'),
      documents: app.getPath('documents'),
      logs: app.getPath('logs'),
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

async function metricsCheck(id: string) {
  await check(id, 'main', 'every process sandboxed=true', () => app.getAppMetrics().map(m => ({
    pid: m.pid,
    type: m.type,
    name: (m as any).name ?? null,
    serviceName: (m as any).serviceName ?? null,
    sandboxed: (m as any).sandboxed ?? null,
  })));
}

async function rendererReady() {
  await check('renderer-ready', 'main', 'ok (renderer helper starts)', async () => {
    mainWindow = await waitForMainWindow(90000);
    return { url: mainWindow.webContents.getURL(), loading: mainWindow.webContents.isLoading() };
  }, 100000);
  await check('renderer-env', 'renderer', 'process.mas=true, sandboxed', () => rendererEval(`return {
    type: process.type, mas: process.mas === undefined ? null : process.mas, sandboxed: process.sandboxed === undefined ? null : process.sandboxed,
    os_homedir: os.homedir(), HOME: process.env.HOME || null, TMPDIR: process.env.TMPDIR || null, pid: process.pid,
    has_require: typeof require === 'function' };`));
}

// ---------- phases ----------

async function phase1() {
  await envCheck();
  await rendererReady();

  // --- FS, no dialog ---
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
    `fs.writeFileSync(${JSON.stringify(udRendererFile)}, 'renderer'); return { path: ${JSON.stringify(udRendererFile)}, readBack: fs.readFileSync(${JSON.stringify(udRendererFile)}, 'utf8') };`));
  await check('renderer-fs-etc-ssl-cert', 'renderer', 'ok', () => rendererRead('/etc/ssl/cert.pem'));
  await check('renderer-fs-netrc-read', 'renderer', 'EPERM', () => rendererRead(netrcPath));
  await check('renderer-fs-documents-direct-read', 'renderer', 'EPERM', () => rendererRead(docsIn));

  // --- DIALOG: open ---
  let openedPath: string | null = null;
  await check('dialog-open', 'main', 'ok; bookmarks[0] non-empty (MAS only)', async () => {
    app.focus({ steal: true });
    stage('open-dialog-shown', { expect: docsIn });
    const r: any = await dialog.showOpenDialog({
      title: 'MASPROBE open',
      defaultPath: path.join(realHome, 'Documents'),
      properties: ['openFile'],
      securityScopedBookmarks: true,
    });
    stage('open-dialog-closed', { canceled: r.canceled, filePaths: r.filePaths });
    openedPath = r.filePaths?.[0] || null;
    const bookmark = r.bookmarks?.[0] || null;
    saveBookmark('open', bookmark, openedPath);
    const detail = {
      canceled: r.canceled,
      filePaths: r.filePaths,
      bookmarks_len: Array.isArray(r.bookmarks) ? r.bookmarks.length : null,
      bookmark0_chars: bookmark ? bookmark.length : 0,
    };
    return r.canceled || !openedPath ? probeError('CANCELED', detail) : detail;
  }, 150000);
  const inPath = openedPath || docsIn;
  await check('dialog-open-main-read', 'main', 'ok (PowerBox grant)', () => mainRead(inPath));
  await check('dialog-open-renderer-read', 'renderer', 'EPERM (grant is main-process only)', () => rendererRead(inPath));
  // A renderer process spawned only after the grant: tells a grant copied at
  // spawn time apart from one shared live by the whole inherited sandbox.
  await check('dialog-open-new-renderer-read', 'renderer', 'EPERM (grant is main-process only)', async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    try {
      await win.loadURL('data:text/html,<p>mas-probe</p>');
      const r = await win.webContents.executeJavaScript(`(() => { try { const d = require('fs').readFileSync(${JSON.stringify(inPath)}, 'utf8'); return { ok: true, bytes: d.length }; } catch (e) { return { ok: false, code: e.code || e.name, message: e.message }; } })()`, true);
      const detail = { new_renderer_pid: win.webContents.getOSProcessId(), main_window_renderer_pid: mainWindow?.webContents.getOSProcessId() ?? null, ...r };
      return r.ok ? detail : probeError(r.code, detail);
    } finally {
      win.destroy();
    }
  });

  // --- DIALOG: save ---
  let savedPath: string | null = null;
  await check('dialog-save', 'main', 'ok; bookmark non-empty (MAS only)', async () => {
    app.focus({ steal: true });
    stage('save-dialog-shown', { expect: docsOut });
    const r: any = await dialog.showSaveDialog({
      title: 'MASPROBE save',
      defaultPath: docsOut,
      securityScopedBookmarks: true,
    });
    stage('save-dialog-closed', { canceled: r.canceled, filePath: r.filePath });
    savedPath = r.filePath || null;
    saveBookmark('save', r.bookmark, savedPath);
    const detail = { canceled: r.canceled, filePath: r.filePath, bookmark_chars: r.bookmark ? r.bookmark.length : 0 };
    return r.canceled || !savedPath ? probeError('CANCELED', detail) : detail;
  }, 150000);
  const outPath = savedPath || docsOut;
  await check('dialog-save-renderer-write', 'renderer', 'EPERM (grant is main-process only)', () => rendererWrite(outPath, `renderer ${Date.now()}\n`));
  await check('dialog-save-main-write', 'main', 'ok (PowerBox grant)', () => mainWrite(outPath, `main ${Date.now()}\n`));
  await check('dialog-save-renderer-read-after-main-write', 'renderer', 'EPERM', () => rendererRead(outPath));
  await check('dialog-save-main-write-sibling', 'main', 'EPERM (grant covers the chosen file only)', () =>
    mainWrite(path.join(path.dirname(outPath), 'probe-out-sibling.txt'), 'sibling'));
  // Give the test script a window to run sandbox_check() on every process against the granted paths.
  stage('dialogs-done', { renderer_pid: mainWindow?.webContents.getOSProcessId() ?? null });
  await new Promise(r => setTimeout(r, 6000));

  await check('fs-app-group-container-rw', 'main', 'ok with a team-signed build (ad-hoc: containermanagerd rejects the group)', () =>
    mainWrite(path.join(realHome, 'Library', 'Group Containers', 'M4B2LM9HCJ.com.insomnium.app', 'mas-probe.txt'), `group ${Date.now()}`));

  // --- NETWORK ---
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
      res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization || null }));
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
  await check('net-http-loopback-self', 'main', 'ok', async () => (port ? httpGet(`${base}/self`) : probeError('NO_SERVER', null)));
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
    ? rendererEval(`const r = await fetch(${JSON.stringify(`${base}/renderer`)}); return { status: r.status, body: await r.text() };`)
    : probeError('NO_SERVER', null)));

  // --- CHILD PROCESSES ---
  await check('child-run-as-node', 'main', 'crash/kill (child exe carries app-sandbox without inherit)', () =>
    spawnResult(spawnSync(process.execPath, ['-e', 'console.log(1)'], {
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeout: 20000,
      encoding: 'utf8',
    }), s => s.trim() === '1'), 30000);
  // Same child, but have it report its own view: home, ~/.netrc, the file the
  // parent was granted by the open dialog, and the parent's container.
  const childScript = `const fs = require('fs'), os = require('os');
    const t = p => { try { fs.readFileSync(p); return 'ok'; } catch (e) { return e.code || String(e); } };
    const [netrc, docs, ud] = process.argv.slice(1);
    console.log(JSON.stringify({ one: 1, pid: process.pid, homedir: os.homedir(), HOME: process.env.HOME || null,
      netrc: t(netrc), granted_doc: t(docs), parent_userdata_file: t(ud) }));`;
  await check('child-run-as-node-view', 'main', 'child is sandboxed with its own copy of the entitlements; no parent grant', () => {
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
  await check('child-yarn-version', 'main', 'crash/kill (bundled yarn via ELECTRON_RUN_AS_NODE)', () =>
    spawnResult(spawnSync(process.execPath, ['--no-deprecation', yarnPath, '--version'], {
      env: { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: 'true' },
      timeout: 30000,
      encoding: 'utf8',
    }), s => /^\d+\.\d+/.test(s.trim())), 40000);
  const pluginDir = path.join(process.env['INSOMNIA_DATA_PATH'] || app.getPath('userData'), 'plugins', PLUGIN);
  await check('child-plugin-install', 'main', 'error (yarn child is process.execPath)', async () => {
    const { default: installPlugin } = await import('./install-plugin');
    await installPlugin(PLUGIN);
    const ok = fs.existsSync(path.join(pluginDir, 'package.json'));
    return ok ? { plugin: PLUGIN, pluginDir, files: fs.readdirSync(pluginDir) } : probeError('NOT_INSTALLED', { plugin: PLUGIN, pluginDir });
  }, 150000);
  await check('child-plugin-load-renderer', 'renderer', 'ok if installed (plugins load from the container)', () => (fs.existsSync(pluginDir)
    ? rendererEval(`const m = require(${JSON.stringify(pluginDir)}); return { exports: Object.keys(m || {}) };`)
    : probeError('NOT_INSTALLED', pluginDir)));

  // --- MCP ---
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
    const health = await httpGet(`http://127.0.0.1:${mcpPort}/health`);
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

  await metricsCheck('env-process-metrics');
  if (server) {
    (server as http.Server).close();
  }
}

async function phase2() {
  await envCheck();
  await rendererReady();
  await check('persist-direct-read', 'main', 'EPERM (no grant after relaunch)', () => mainRead(docsIn));
  await check('persist-renderer-direct-read', 'renderer', 'EPERM (no grant after relaunch)', () => rendererRead(docsIn));
  let stop: any = null;
  await check('persist-bookmark-read', 'main', 'ok (security-scoped bookmark)', () => {
    const bookmark = loadBookmark('open');
    if (!bookmark) {
      return probeError('NO_BOOKMARK', 'phase 1 saved no open-dialog bookmark');
    }
    const fn = (app as any).startAccessingSecurityScopedResource;
    if (typeof fn !== 'function') {
      return probeError('API_MISSING', 'app.startAccessingSecurityScopedResource is not a function in this build');
    }
    stop = fn.call(app, bookmark);
    return { ...mainRead(docsIn), stop_is_function: typeof stop === 'function' };
  });
  // While main holds the bookmark's access open, can the renderer read too?
  await check('persist-renderer-read-during-access', 'renderer', 'EPERM (access is main-process only)', () => rendererRead(docsIn));
  stage('bookmark-access-open', { renderer_pid: mainWindow?.webContents.getOSProcessId() ?? null });
  await new Promise(r => setTimeout(r, 6000));
  if (typeof stop === 'function') {
    stop();
  }
  await check('persist-renderer-read-after-stop', 'renderer', 'EPERM', () => rendererRead(docsIn));
  await check('persist-direct-read-after-stop', 'main', 'EPERM', () => mainRead(docsIn));
  await check('persist-save-bookmark-write', 'main', 'ok (security-scoped bookmark)', () => {
    const bookmark = loadBookmark('save');
    if (!bookmark) {
      return probeError('NO_BOOKMARK', 'phase 1 saved no save-dialog bookmark');
    }
    const fn = (app as any).startAccessingSecurityScopedResource;
    if (typeof fn !== 'function') {
      return probeError('API_MISSING', 'app.startAccessingSecurityScopedResource is not a function in this build');
    }
    const stop = fn.call(app, bookmark);
    try {
      return mainWrite(docsOut, `phase2 ${Date.now()}\n`);
    } finally {
      if (typeof stop === 'function') {
        stop();
      }
    }
  });
}

async function phase3() {
  await envCheck();
  await check('relaunch-call', 'main', 'relaunched instance writes relaunched.json (may crash)', () => {
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
  fs.writeFileSync(path.join(probeDir, `relaunched${TAG}.json`), JSON.stringify(info, null, 2));
  stage('relaunched-marker-written', info);
}

export async function runMasProbe() {
  probeDir = path.join(app.getPath('userData'), 'mas-probe');
  app.on('render-process-gone', (_e, _wc, details) => {
    processGone.push({ kind: 'render', ...details, at: new Date().toISOString() });
    out(`MASPROBE:PROCESS-GONE render ${JSON.stringify(details)}`);
  });
  app.on('child-process-gone', (_e, details) => {
    processGone.push({ kind: 'child', ...details, at: new Date().toISOString() });
    out(`MASPROBE:PROCESS-GONE child ${JSON.stringify(details)}`);
  });
  stage('start', { phase, pid: process.pid, userData: app.getPath('userData') });

  // Whole-probe watchdog so a stuck check still produces a report and exits.
  const watchdog = setTimeout(() => {
    flush({ watchdog: 'fired' });
    out('MASPROBE:WATCHDOG fired');
    app.exit(4);
  }, 480000);

  if (phase === 'relaunched') {
    await relaunched();
    clearTimeout(watchdog);
    // stay up briefly so the test script can sandbox_check() this pid
    setTimeout(() => app.exit(0), 8000);
    return;
  }
  if (phase === '1') {
    await phase1();
  } else if (phase === '2') {
    await phase2();
  } else if (phase === '3') {
    await phase3();
  }
  clearTimeout(watchdog);
  const report = buildReport({ finished: true });
  flush({ finished: true });
  out('MASPROBE:REPORT-BEGIN');
  out(JSON.stringify(report));
  out('MASPROBE:REPORT-END');
  out(`MASPROBE:REPORT-PATH ${path.join(probeDir, `probe-report-phase${phase}${TAG}.json`)}`);
  stage('done');
  setTimeout(() => app.exit(0), 500);
}
