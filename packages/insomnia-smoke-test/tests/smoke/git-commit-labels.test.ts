import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('Commit Changes calls a collection a collection @ci', async ({ page }) => {
  // Git Sync with no remote
  await page.getByRole('button', { name: 'Git Sync' }).click();
  await page.getByRole('menuitem', { name: 'Setup Git Sync' }).click();
  await page.locator('input[name="authorName"]').fill('Kim');
  await page.locator('input[name="authorEmail"]').fill('kim@example.com');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();

  await page.getByTestId('git-dropdown').locator('button').click();
  await page.getByRole('menuitem', { name: 'Commit' }).click();
  const workspaceRow = page.getByRole('dialog').getByRole('row', { name: /My Collection/ });
  await expect(workspaceRow).toContainText('Collection');
  await expect(workspaceRow).not.toContainText('Document');
});
