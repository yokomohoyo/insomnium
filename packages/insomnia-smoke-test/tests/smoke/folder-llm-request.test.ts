import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Models, scope: collection }
  - { _id: fld_1, _type: request_group, parentId: wrk_1, name: Chats }
`;

test('a folder makes an LLM request, as the collection does @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  const requests = page.getByLabel('Request Collection');
  await requests.getByRole('row', { name: 'Chats' }).getByLabel('Request Group Actions').click();
  await page.getByRole('menuitemradio', { name: 'LLM Request' }).click();
  await expect(requests.getByRole('row', { name: 'New LLM Request' })).toBeVisible();
  await expect(page.getByTestId('request-pane').getByRole('button', { name: 'Connect' })).toBeVisible();
});
