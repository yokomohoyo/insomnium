import { type ElectronApplication, expect, type Page, test as baseTest } from '@playwright/test';
import path from 'path';

import { importIntoProject } from '../../playwright/import';
import { cwd, executablePath, mainPath, randomDataPath } from '../../playwright/paths';
import { openRequest } from '../../playwright/requests';
import { bookshopCollection, bookshopSpec, startBookshop } from './bookshop';

// Takes the README's screenshots, of a Bookshop API collection sent to a
// server started here. Each is the window at 1600 x 850, at one and a half times the pixels.
//   npm run app-build, then npm run screenshots -w packages/insomnia-smoke-test

const screenshots = path.resolve(__dirname, '..', '..', '..', '..', 'screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(screenshots, `${name}.png`) });

const test = baseTest.extend<{ app: ElectronApplication; page: Page }>({
  app: async ({ playwright }, run) => {
    const app = await playwright._electron.launch({
      cwd,
      executablePath,
      args: ['--force-device-scale-factor=1.5', mainPath],
      env: { ...process.env, INSOMNIA_DATA_PATH: randomDataPath(), INSOMNIUM_LANGUAGE: 'en', PLAYWRIGHT: 'true' },
    });
    await run(app);
    await app.close();
  },
  page: async ({ app }, run) => {
    const page = await app.firstWindow();
    await page.waitForLoadState();
    await app.evaluate(({ BrowserWindow, nativeTheme }) => {
      nativeTheme.themeSource = 'dark';
      const window = BrowserWindow.getAllWindows()[0];
      window.unmaximize();
      window.setContentSize(1600, 850);
      window.setPosition(0, 0);
    });
    // the app's own theme, whatever this computer's color scheme is
    await page.getByTestId('settings-button').click();
    await page.getByRole('tab', { name: 'Themes' }).click();
    await page.locator('input[name="autoDetectColorScheme"]').click();
    await expect(page.locator('input[name="autoDetectColorScheme"]')).not.toBeChecked();
    await page.keyboard.press('Escape');
    await importIntoProject(app, page, bookshopCollection, 'Bookshop API');
    await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'Health check' })).toBeVisible();
    await run(page);
  },
});

let bookshop: { close: () => void };
test.beforeAll(async () => {
  bookshop = await startBookshop();
});
test.afterAll(() => {
  bookshop.close();
});

const send = async (page: Page, name: string, status: string) => {
  await openRequest(page, name);
  await expect(page.getByTestId('request-pane').locator('.CodeMirror').first()).toBeVisible();
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('response-pane')).toContainText(status);
};

// the one at the top of the README, named after the version it shows
test('overview', async ({ page }) => {
  await send(page, 'Create book', '201 Created');
  await shot(page, 'v0.9');
});

test('scripts and tests', async ({ page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');
  await send(page, 'Create book', '201 Created');
  await requestPane.getByRole('tab', { name: /Scripts/ }).click();
  await responsePane.getByRole('tab', { name: /Tests/ }).click();
  await expect(responsePane.getByTestId('assertion-summary')).toBeVisible();
  await shot(page, 'scripts');
});

test('flows', async ({ page }) => {
  await page.getByRole('link', { name: 'flows', exact: true }).click();
  await page.getByRole('button', { name: 'New Flow' }).first().click();
  await page.getByRole('dialog').getByRole('textbox').fill('Order a book');
  await page.getByRole('dialog').getByRole('button', { name: 'Create Flow' }).click();

  const toolbar = page.getByRole('toolbar', { name: 'Flow' });
  const step = page.getByRole('region', { name: 'Step' });
  const request = async (name: string) => {
    await toolbar.getByRole('button', { name: 'Request' }).click();
    const label = await step.getByLabel('Request').locator('option', { hasText: name }).textContent();
    await step.getByLabel('Request').selectOption({ label: label || name });
  };
  await request('Get access token');
  await toolbar.getByRole('button', { name: 'Condition' }).click();
  await toolbar.getByRole('button', { name: 'Set Variable' }).click();
  await step.getByLabel('Name', { exact: true }).fill('token');
  await step.getByLabel('Value from').selectOption('jsonpath');
  await step.getByLabel('JSON path').fill('$.access_token');
  await request('Place order');
  await request('List orders');

  // two rows of three, so the steps are large enough to read
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(500);
  const nodes = page.locator('.react-flow__node');
  for (const index of [3, 4, 5]) {
    const above = await nodes.nth(index - 3).boundingBox();
    const box = await nodes.nth(index).boundingBox();
    if (!above || !box) {
      throw new Error('a step is missing from the canvas');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(above.x + box.width / 2, above.y + above.height / 2 + 70, { steps: 10 });
    await page.mouse.up();
  }
  await page.locator('.react-flow__controls-fitview').click();

  await toolbar.getByRole('button', { name: 'Run Flow' }).click();
  await expect(page.getByRole('region', { name: 'Run' }).getByRole('status')).toHaveText('Done');
  await page.waitForTimeout(500);
  await shot(page, 'flows');
});

test('runner', async ({ page }) => {
  await page.getByRole('button', { name: 'Bookshop API' }).click();
  await page.getByRole('menuitem', { name: 'Run Collection' }).click();
  const runner = page.getByRole('dialog');
  await runner.getByLabel('Iterations').fill('5');
  await runner.getByRole('button', { name: /^Run \d+ requests$/ }).click();
  await expect(runner.getByTestId('run-summary')).toContainText('requests passed');
  await runner.getByTestId('run-summary').evaluate(summary => summary.scrollIntoView({ block: 'start' }));
  await shot(page, 'runner');
});

test('mock server', async ({ page }) => {
  await page.getByRole('button', { name: 'Bookshop API' }).click();
  await page.getByRole('menuitem', { name: 'Mock Server' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Start' }).click();
  const url = await dialog.getByTestId('mock-server-url').textContent();
  await fetch(`${url}/books`);
  await fetch(`${url}/books/42`);
  await fetch(`${url}/books/42`, { headers: { 'x-mock-response-name': 'Not found' } });
  await fetch(`${url}/orders`, { method: 'POST' });
  await fetch(`${url}/authors`);
  await expect(dialog.getByRole('list', { name: 'Mock requests' })).toContainText('Not found');
  await shot(page, 'mock-server');
  await dialog.getByRole('button', { name: 'Stop' }).click();
});

test('load test', async ({ page }) => {
  await page.getByRole('button', { name: 'Bookshop API' }).click();
  await page.getByRole('menuitem', { name: 'Run Collection' }).click();
  const runner = page.getByRole('dialog');
  await runner.getByLabel('Load test').check();
  await runner.getByLabel('Virtual users').fill('8');
  await runner.getByLabel('Duration (s)').fill('12');
  await runner.getByLabel('Fail when p95 is over (ms)').fill('250');
  await runner.getByLabel('Fail when more than this fail (%)').fill('1');
  await runner.getByRole('button', { name: 'Start the Load Test' }).click();
  await expect(runner.getByTestId('load-summary')).not.toContainText('Running', { timeout: 40_000 });
  await runner.getByTestId('load-summary').evaluate(summary => summary.scrollIntoView({ block: 'start' }));
  await shot(page, 'load-test');
});

test('graphql', async ({ page }) => {
  await openRequest(page, 'Books in stock');
  await page.getByRole('button', { name: 'schema' }).click();
  await page.getByRole('menuitem', { name: 'Refresh Schema' }).click();
  await expect(page.locator('.graphql-editor__meta')).toContainText('schema fetched just now');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('response-pane')).toContainText('200 OK');
  await page.getByRole('button', { name: 'schema' }).click();
  await page.getByRole('menuitem', { name: 'Show Documentation' }).click();
  await page.click('a:has-text("Query")');
  await page.locator('.graphql-explorer a', { hasText: /^Book$/ }).first().click();
  await expect(page.locator('.graphql-explorer')).toContainText('A book the shop sells.');
  await shot(page, 'graphql');
});

test('grpc', async ({ page }) => {
  await openRequest(page, 'Watch stock');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-testid="response-status-tag"]:visible')).toContainText('0 OK');
  await expect(page.getByText('Received at:')).toHaveCount(6);
  await shot(page, 'grpc');
});

test('websocket', async ({ page }) => {
  await openRequest(page, 'Order events');
  const editor = page.locator('#websocketMessageForm .CodeMirror');
  await editor.click();
  await page.keyboard.insertText('{ "action": "watch", "book_id": 42 }');
  await page.getByRole('button', { name: 'Connect' }).click();
  const events = page.getByTestId('response-pane').filter({ hasText: 'subscribed' });
  await expect(events).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(events).toContainText('order.shipped');
  await events.getByText('order.paid').first().click();
  await shot(page, 'websocket');
});

test('mcp request', async ({ page }) => {
  await openRequest(page, 'Bookshop MCP server');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByTestId('mcp-server')).toContainText('bookshop');
  const responsePane = page.getByTestId('response-pane').filter({ has: page.getByTestId('mcp-server') });
  await responsePane.locator('.CodeMirror').first().click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('{ "query": "le guin", "in_stock": true }');
  await responsePane.getByRole('button', { name: 'Call' }).click();
  await expect(page.getByTestId('mcp-result')).toContainText('Darkness');
  await shot(page, 'mcp-request');
});

test('llm', async ({ page }) => {
  await openRequest(page, 'Recommend a book');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('tab', { name: 'LLM' }).click();
  await expect(page.getByTestId('llm-usage')).toContainText('104 total');
  await shot(page, 'llm');
});

test('git sync', async ({ page }) => {
  await page.getByRole('button', { name: 'Git Sync' }).click();
  await page.getByRole('menuitem', { name: 'Setup Git Sync' }).click();
  await page.locator('input[name="authorName"]').fill('Kim');
  await page.locator('input[name="authorEmail"]').fill('kim@example.com');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();

  const gitMenu = page.getByTestId('git-dropdown').locator('button');
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Commit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('A descriptive message to describe changes made').fill('the bookshop collection');
  await dialog.locator('input[name="allUnversioned"]').check();
  await dialog.getByRole('button', { name: 'Commit' }).click();
  await expect(dialog).toContainText('Committed.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // two requests changed, to commit
  await openRequest(page, 'Update book');
  await page.getByTestId('request-pane').locator('.method-dropdown button').click();
  await page.getByRole('menuitem', { name: 'PATCH' }).click();
  await openRequest(page, 'Health check');
  await page.getByTestId('request-pane').locator('.method-dropdown button').click();
  await page.getByRole('menuitem', { name: 'HEAD' }).click();
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Commit' }).click();
  await dialog.getByPlaceholder('A descriptive message to describe changes made').fill('update a book with PATCH, check health with HEAD');
  await dialog.getByTestId('changed-fields').first().locator('summary').click();
  await shot(page, 'git-sync');
});

test('design document', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), bookshopSpec);
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create in project' }).click();
  await page.getByRole('menuitemradio', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Bookshop API 1.4.2').click();
  await page.getByRole('link', { name: 'spec', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate Request Collection' })).toBeVisible();
  await page.waitForTimeout(3000);
  await shot(page, 'design-document');
});
