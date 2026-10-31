import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Names', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'one pet', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/1' } }],
});

test('the URL bar and the editors have names @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'one pet' }).click();

  const requestPane = page.getByTestId('request-pane');
  await expect(requestPane.getByRole('textbox', { name: 'URL', exact: true })).toHaveCount(1);
  await requestPane.getByRole('button', { name: 'Send' }).click();

  const responsePane = page.getByTestId('response-pane');
  await expect(responsePane).toContainText('"id": "1"');
  await expect(responsePane.getByRole('textbox', { name: 'Response body' })).toHaveCount(1);
});
