// Lightweight smoke driver — launches the built bundle under Playwright,
// spins up an inline HTTP server, fills the seeded GET request, clicks Send,
// asserts a 200 response renders. Verifies libcurl native binding actually
// transfers data through electron. Run with:
//   BUNDLE=build node scripts/verify-smoke.mjs
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const INSOMNIA = path.join(REPO, 'packages', 'insomnia');
const BUNDLE = process.env.BUNDLE || 'build';
const electronBin = path.join(REPO, 'node_modules', '.bin', 'electron');
const mainJs = path.join(INSOMNIA, BUNDLE === 'dev' ? 'src' : 'build', 'main.min.js');

// Inline server avoids depending on httpbin.org / network in CI.
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, marker: 'insomnium-smoke' }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const target = `http://127.0.0.1:${server.address().port}/ping`;
console.log(`[smoke] inline target: ${target}`);

console.log(`[smoke] launching electron with ${mainJs}`);
const app = await electron.launch({
  cwd: INSOMNIA,
  executablePath: electronBin,
  args: [mainJs],
  env: {
    ...process.env,
    INSOMNIA_DATA_PATH: path.join('/tmp', `insomnia-smoke-${Date.now()}`),
    PLAYWRIGHT: 'true',
  },
  timeout: 30_000,
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(8_000);

try {
  const collection = page.locator('text=My Collection').first();
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
