// Lightweight smoke driver — launches the built bundle under Playwright,
// spins up an inline HTTP server, fills the seeded GET request, clicks Send,
// asserts a 200 response renders. Verifies libcurl native binding actually
// transfers data through electron. Run with:
//   BUNDLE=build node scripts/verify-smoke.mjs
// or, for an installed app:
//   APP_EXE=<path to Insomnium.exe> node scripts/verify-smoke.mjs
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { _electron as electron, chromium } from '@playwright/test';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const INSOMNIA = path.join(REPO, 'packages', 'insomnia');
const BUNDLE = process.env.BUNDLE || 'build';
// Node won't spawn a .cmd (CVE-2024-27980), so on Windows launch electron.exe itself
const electronBin = process.platform === 'win32'
  ? path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(REPO, 'node_modules', '.bin', 'electron');
const mainJs = path.join(INSOMNIA, BUNDLE === 'dev' ? 'src' : 'build', 'main.min.js');

// Inline server avoids depending on httpbin.org / network in CI.
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, marker: 'insomnium-smoke' }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const target = `http://127.0.0.1:${server.address().port}/ping`;
console.log(`[smoke] inline target: ${target}`);

const env = {
  ...process.env,
  // app.setPath wants a drive letter on Windows, so not /tmp
  INSOMNIA_DATA_PATH: path.join(os.tmpdir(), `insomnia-smoke-${Date.now()}`),
  PLAYWRIGHT: 'true',
};

// An installed app (APP_EXE=<its exe>): a released build won't take a
// debugger from Playwright's launcher (the inspect fuse is off), so it is
// started as a user would and driven over the DevTools protocol.
const launchInstalled = async exe => {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise(r => probe.close(r));

  console.log(`[smoke] starting ${exe} with DevTools on ${port}`);
  const child = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  let browser;
  for (let attempt = 0; !browser; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (err) {
      if (attempt === 30) {
        throw err;
      }
      await new Promise(r => setTimeout(r, 1_000));
    }
  }
  const pages = () => browser.contexts().flatMap(context => context.pages()).filter(p => !p.url().startsWith('devtools://'));
  for (let attempt = 0; pages().length === 0; attempt++) {
    if (attempt === 30) {
      throw new Error('the app opened no window');
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  return {
    page: pages()[0],
    close: async () => {
      await browser.close().catch(() => {});
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      } else {
        child.kill();
      }
    },
  };
};

const launchBundle = async () => {
  console.log(`[smoke] launching electron with ${mainJs}`);
  const app = await electron.launch({
    cwd: INSOMNIA,
    executablePath: electronBin,
    args: [mainJs],
    env,
    timeout: 30_000,
  });
  return { page: await app.firstWindow(), close: () => app.close() };
};

const app = process.env.APP_EXE ? await launchInstalled(process.env.APP_EXE) : await launchBundle();
const { page } = app;
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(8_000);

// on the projects page, open the collection; a fresh install starts inside it,
// where the same name is the breadcrumb's menu
try {
  const collection = page.locator('[role="gridcell"], [role="row"]').filter({ hasText: 'My Collection' }).first();
  if (await collection.isVisible({ timeout: 2_000 })) {
    await collection.click();
    await page.waitForTimeout(2_000);
  }
} catch { /* already inside */ }

const getRow = page.locator('[role="row"], [role="gridcell"], button').filter({ hasText: /^GET/ }).first();
await getRow.click({ timeout: 10_000 });
await page.waitForTimeout(1_000);

const urlEditor = page.locator('[data-testid="request-url-bar"], input[placeholder*="URL" i], input[placeholder*="https" i]').first();
if (await urlEditor.isVisible({ timeout: 2_000 }).catch(() => false)) {
  await urlEditor.fill(target);
} else {
  await page.locator('[data-testid="request-pane"] .CodeMirror').first().click();
  await page.keyboard.type(target);
}
await page.waitForTimeout(500);

await page.locator('[data-testid="request-pane"]').getByRole('button', { name: 'Send' }).click();
console.log('[smoke] Send clicked, waiting for response...');

const statusTag = page.locator('[data-testid="response-status-tag"]:visible');
await statusTag.waitFor({ timeout: 20_000 });
const statusText = (await statusTag.textContent())?.trim();
console.log(`[smoke] response status: ${statusText}`);

await app.close();
server.close();

if (!statusText?.startsWith('200')) {
  console.error(`[smoke] FAIL: expected 200, got "${statusText}"`);
  process.exit(1);
}
console.log('[smoke] PASS');
