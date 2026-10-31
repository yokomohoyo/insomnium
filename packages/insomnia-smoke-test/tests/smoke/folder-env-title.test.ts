import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Overrides, scope: collection }
  - { _id: fld_1, _type: request_group, parentId: wrk_1, name: Staging }
`;

test("a folder's environment is titled for its table and its JSON @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  await page.getByLabel('Request Collection').getByRole('row', { name: 'Staging' }).getByLabel('Request Group Actions').click();
  await page.getByRole('menuitemradio', { name: 'Environment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Environment Overrides');
  await expect(dialog).not.toContainText('JSON Format');
});
