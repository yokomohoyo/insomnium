import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Examples', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet with example', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/3' } }],
});

test('a response saved as an example shows in the request\'s Examples tab @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pet with example');

  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('200 OK');
  // the response history menu
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+H' : 'Control+Shift+H');
  await page.getByRole('menuitem', { name: 'Save as Example' }).click();

  await requestPane.getByRole('tab', { name: /Examples/ }).click();
  await expect(requestPane.getByRole('tab', { name: /Examples/ })).toContainText('1');
  await expect(requestPane.getByLabel('Example', { exact: true })).toContainText('200 OK');
  await expect(requestPane.getByLabel('Status code')).toHaveValue('200');
  await expect(requestPane.getByRole('tabpanel').locator('.CodeMirror')).toContainText('"id":"3"');
  await page.screenshot({ path: 'traces/response-examples.png' });
});
