import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Secrets', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet from a secret', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/{{petId}}' } }],
});

test("a secret variable is masked, kept out of the environment's JSON, and sent @ci", async ({ app, page }) => {
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
  await dialog.getByLabel('Variable name').last().fill('petId');
  await dialog.getByLabel('petId is secret').check();
  await dialog.getByLabel('Variable value').last().fill('7');
  await dialog.getByLabel('Variable value').last().press('Tab');

  // masked until shown
  await expect(dialog.getByLabel('Variable value').last()).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: 'Show petId' }).click();
  await expect(dialog.getByLabel('Variable value').last()).toHaveAttribute('type', 'text');
  await page.screenshot({ path: 'traces/environment-secrets.png' });

  // the JSON view has the name, not the value
  await dialog.getByRole('button', { name: 'JSON' }).click();
  await expect(dialog.locator('.CodeMirror')).toContainText('"petId": ""');
  await expect(dialog).toContainText('Secret values (petId) are kept apart');
  await dialog.getByRole('button', { name: 'Close' }).click();

  await openRequest(page, 'pet from a secret');
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('"id": "7"');
});
