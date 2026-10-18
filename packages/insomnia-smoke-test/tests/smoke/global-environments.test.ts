import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const globals = JSON.stringify({
  name: 'My Workspace Globals',
  _postman_variable_scope: 'globals',
  values: [{ key: 'pet', value: 'global-7', enabled: true }],
});

const collection = JSON.stringify({
  info: { name: 'Globals', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet from globals', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/{{pet}}' } }],
});

test("a project's global environments reach its collections, and each collection picks its global sub environment @ci", async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');
  const importFromClipboard = async (text: string) => {
    await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
    await page.getByRole('button', { name: 'My Collection' }).click();
    await page.getByRole('menuitem', { name: 'Import' }).click();
    await page.getByText('Clipboard').click();
    await page.getByRole('button', { name: 'Scan' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  };

  // Postman's globals go to the project's global base environment
  await importFromClipboard(globals);
  await importFromClipboard(collection);
  await page.getByLabel('Request Collection').getByRole('row', { name: 'pet from globals' }).click();
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('global-7');

  // a global sub environment, used by this collection, over the base
  await page.getByRole('button', { name: 'Global Environments' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'Global environments' })).toContainText('Global Base Environment');
  await expect(dialog.locator('.CodeMirror')).toContainText('global-7');
  await dialog.getByRole('button', { name: 'Add Sub Environment' }).click();
  await dialog.getByLabel('Environment name').fill('Staging');
  await dialog.locator('.CodeMirror').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('{ "pet": "staging-9" }');
  await dialog.getByRole('button', { name: 'Use in This Collection' }).click();
  await expect(dialog.getByRole('list', { name: 'Global environments' })).toContainText('Staging(in use)');
  await page.screenshot({ path: 'traces/global-environments.png' });
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('button', { name: 'Global Environments' })).toContainText('Globals: Staging');
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('staging-9');
});
