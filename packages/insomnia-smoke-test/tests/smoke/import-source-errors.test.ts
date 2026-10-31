import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test("a scan's error goes with its source, and says what's wrong with the clipboard's @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }) => clipboard.writeText('this is not an export {'));
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog');
  const error = dialog.locator('.notice.error');

  await dialog.getByText('File', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Scan' }).click();
  await expect(error).toContainText('File is required');

  // another source: the file's error isn't about it
  await dialog.getByText('Clipboard').click();
  await expect(error).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Scan' }).click();
  await expect(error).toContainText("It isn't in a format the app can import");
  await expect(error).not.toContainText('for file');
});
