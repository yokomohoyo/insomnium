// SPIKE ONLY (spike/mas-sandbox, never merge).
// Merge the per-phase probe reports, the host snapshots and the unified log into
// probe-report.json, summary.tsv and sandbox-evidence.tsv.
//   node merge-report.js <evidence-dir> <flavor> <os-label>
'use strict';
const fs = require('fs');
const path = require('path');

const [dir, flavor, oslabel] = process.argv.slice(2);
const read = f => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch {
    return null;
  }
};
const text = f => {
  try {
    return fs.readFileSync(path.join(dir, f), 'utf8');
  } catch {
    return '';
  }
};

const PHASES = ['1', '2', '3', 'relaunched', '3-ls', 'relaunched-ls', 'lsd', 'url-cold', '4'];
const phases = {};
for (const p of PHASES) {
  let r = read(`probe-report-phase${p}.json`) || read(`agent-reports/probe-report-phase${p}.json`) || read(`probe-report-phase${p}.stdout.json`);
  if (!r) {
    // last resort: the MASPROBE:CHECK lines of the phase's stdout
    const checks = text(`phase${p}.stdout.log`).split('\n').filter(l => l.includes('MASPROBE:CHECK ')).map(l => {
      try {
        return JSON.parse(l.slice(l.indexOf('MASPROBE:CHECK ') + 15));
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (checks.length) {
      r = { reconstructed_from_stdout: true, checks };
    }
  }
  phases[p] = r;
}

// libsecinit "AppSandbox" activity per pid (the process initialised the App Sandbox)
const secinit = new Map();
for (const line of text('unified-log.txt').split('\n')) {
  const m = line.match(/ ([^ [][^[]*)\[(\d+)\]: \(libsystem_secinit\.dylib\).*Description: AppSandbox/);
  if (m) {
    secinit.set(Number(m[2]), m[1].trim());
  }
}

const evidence = [];
const snapDir = path.join(dir, 'snapshots');
if (fs.existsSync(snapDir)) {
  for (const f of fs.readdirSync(snapDir).sort()) {
    let procs = [];
    try {
      procs = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8'));
    } catch {
      continue;
    }
    for (const p of procs) {
      evidence.push({
        snapshot: f.replace(/\.json$/, ''),
        pid: p.pid,
        kind: p.kind,
        sandboxed: p.sandboxed,
        etc_ssl_cert_pem: p.etc_ssl_cert_pem,
        libsecinit_appsandbox: secinit.has(p.pid),
        deny: p.deny,
      });
    }
  }
}
fs.writeFileSync(path.join(dir, 'sandbox-evidence.tsv'), `${['snapshot', 'pid', 'kind', 'sandbox_check', 'etc_ssl_cert_pem', 'libsecinit_AppSandbox', 'denied'].join('\t')}\n${
  evidence.map(e => [e.snapshot, e.pid, e.kind, e.sandboxed, e.etc_ssl_cert_pem, e.libsecinit_appsandbox, e.deny.join(', ')].join('\t')).join('\n')}\n`);

const observations = text('observations.txt').split('\n').filter(Boolean);
const report = {
  os: oslabel,
  flavor,
  sw_vers: text('system.txt').split('\n').slice(0, 3),
  phases,
  relaunched: read('relaunched.json'),
  relaunched_ls: read('relaunched-ls.json'),
  update_info: read('update-info.json'),
  observations,
  sandbox_evidence: evidence,
  libsecinit_appsandbox_pids: Object.fromEntries(secinit),
};
fs.writeFileSync(path.join(dir, 'probe-report.json'), JSON.stringify(report, null, 2));

const rows = [];
for (const [p, r] of Object.entries(phases)) {
  for (const c of (r && r.checks) || []) {
    rows.push([oslabel, flavor, `p${p}`, c.where, c.id, c.result, c.error_code || ''].join('\t'));
  }
}
fs.writeFileSync(path.join(dir, 'summary.tsv'), `${rows.join('\n')}\n`);
console.log(rows.join('\n'));
