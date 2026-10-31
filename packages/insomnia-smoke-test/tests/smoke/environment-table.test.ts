import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Table', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet from the table', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/{{petId}}' } }],
});

test('a variable added in the environment table is sent @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  await page.getByLabel('Manage Environments').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Table' }).click();
  await dialog.getByRole('button', { name: 'Add Variable' }).click();
  // ready for its name
  await expect(dialog.getByLabel('Variable name').last()).toBeFocused();
  await dialog.getByLabel('Variable name').last().fill('petId');
  await dialog.getByLabel('Variable value').last().fill('42');
  await dialog.getByLabel('Variable value').last().press('Tab');
  await page.screenshot({ path: 'traces/environment-table.png' });

  // the JSON view shows the same variables
  await dialog.getByRole('button', { name: 'JSON' }).click();
  await expect(dialog.locator('.CodeMirror')).toContainText('"petId": "42"');
  await dialog.getByRole('button', { name: 'Close' }).click();

  await openRequest(page, 'pet from the table');
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('"id": "42"');
});
