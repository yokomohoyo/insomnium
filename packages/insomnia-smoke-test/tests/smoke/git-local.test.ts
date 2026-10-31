import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a repository on this computer commits, and says what changed in each request @ci', async ({ page }) => {
  // Git Sync with no remote
  await page.getByRole('button', { name: 'Git Sync' }).click();
  await page.getByRole('menuitem', { name: 'Setup Git Sync' }).click();
  await page.locator('input[name="authorName"]').fill('Kim');
  await page.locator('input[name="authorEmail"]').fill('kim@example.com');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();

  const gitMenu = page.getByTestId('git-dropdown').locator('button');
  await gitMenu.click();
  // nothing to push to or pull from
  await expect(page.getByRole('menuitem', { name: 'History' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Push' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Pull' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Commit' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('A descriptive message to describe changes made').fill('first');
  await dialog.locator('input[name="allUnversioned"]').check();
  await dialog.getByRole('button', { name: 'Commit' }).click();
  await expect(dialog).toContainText('Committed.');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // change the request, and see the change before committing it
  await page.getByTestId('request-pane').locator('.method-dropdown button').click();
  await page.getByRole('menuitem', { name: 'POST' }).click();
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Commit' }).click();
  const changed = dialog.getByTestId('changed-fields');
  await expect(changed).toContainText('Changed: method');
  await changed.locator('summary').click();
  await expect(changed).toContainText('GET → POST');
});
