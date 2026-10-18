import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'History', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    { name: 'first pet', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/1' } },
    { name: 'second pet', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/2' } },
  ],
});

test('History lists the responses of every request, and opens one with its request @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  for (const name of ['first pet', 'second pet']) {
    await page.getByLabel('Request Collection').getByRole('row', { name }).click();
    await requestPane.getByRole('button', { name: 'Send' }).click();
    await expect(responsePane).toContainText('200 OK');
  }

  await page.getByRole('button', { name: 'History' }).click();
  const responses = page.getByRole('dialog').getByRole('list', { name: 'Responses' });
  // newest first
  await expect(responses.getByRole('listitem').first()).toContainText('http://127.0.0.1:4010/pets/2');
  await expect(responses.getByRole('listitem').nth(1)).toContainText('first pet');
  await page.screenshot({ path: 'traces/history.png' });

  await responses.getByRole('button', { name: /pets\/1/ }).click();
  await expect(responsePane).toContainText('"id": "1"');
});
