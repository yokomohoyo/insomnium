import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Render error', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet by id', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/{{petId}}' } }],
});

test('an HTTP request with an undefined variable says which field failed to render @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pet by id');

  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  // not "Unexpected Request Failure" with only nunjucks' message
  await expect(dialog).toContainText('Failed to Render Request');
  await expect(dialog).toContainText('Request.url');
});
