import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Query', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pets', request: { method: 'GET', url: { raw: 'http://127.0.0.1:4010/pets?a=1&b=two' } } }],
});

test("Import from URL takes the query out of the URL bar, so editing the URL doesn't put it back @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pets');

  const requestPane = page.getByTestId('request-pane');
  const urlBar = requestPane.getByTestId('OneLineEditor').first();
  await expect(urlBar).toContainText('http://127.0.0.1:4010/pets?a=1&b=two');

  await requestPane.getByRole('tab', { name: 'Query' }).click();
  await requestPane.getByRole('button', { name: 'Import from URL' }).click();
  await expect(urlBar).not.toContainText('?a=1');
  await expect(urlBar).toContainText('http://127.0.0.1:4010/pets');

  // an edit to the URL keeps the query in the table, once
  await urlBar.locator('.CodeMirror textarea').press('End');
  await urlBar.locator('.CodeMirror textarea').pressSequentially('/1');
  await expect(requestPane).toContainText('http://127.0.0.1:4010/pets/1?a=1&b=two');
  await expect(requestPane).not.toContainText('a=1&b=two&a=1');
});
