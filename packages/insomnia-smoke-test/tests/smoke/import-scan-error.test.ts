import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a scan with no file says so, readably @ci', async ({ page }) => {
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('File', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Scan' }).click();
  await expect(dialog.locator('.notice.error')).toHaveText('Error while scanning for resources to import: File is required');
});
