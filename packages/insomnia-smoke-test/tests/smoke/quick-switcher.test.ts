import { expect } from '@playwright/test';

import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test('quick switcher opens a request by name, and Ctrl+Tab goes back @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');

  // the app opens in My Collection; import the smoke requests into it
  const text = await loadFixture('smoke-test-collection.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  await page.getByLabel('Request Collection').getByRole('row', { name: 'sends dummy.xml request and shows raw response' }).click();
  await expect(requestPane).toContainText('127.0.0.1:4010/file/dummy.xml');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
  await page.getByLabel('Filter requests').fill('send JSON');
  await page.keyboard.press('Enter');
  await expect(requestPane).toContainText('127.0.0.1:4010/pets/1');

  // the recent list starts on the previous request
  await page.keyboard.press('Control+Tab');
  await expect(page.getByRole('option', { selected: true })).toContainText('sends dummy.xml request');
  await page.keyboard.press('Enter');
  await expect(requestPane).toContainText('127.0.0.1:4010/file/dummy.xml');
});
