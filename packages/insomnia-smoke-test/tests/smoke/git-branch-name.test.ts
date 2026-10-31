import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a branch name git refuses is said to be a failed branch, not a push @ci', async ({ page }) => {
  // Git Sync with no remote
  await page.getByRole('button', { name: 'Git Sync' }).click();
  await page.getByRole('menuitem', { name: 'Setup Git Sync' }).click();
  await page.locator('input[name="authorName"]').fill('Kim');
  await page.locator('input[name="authorEmail"]').fill('kim@example.com');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();

  await page.getByTestId('git-dropdown').locator('button').click();
  await page.getByRole('menuitem', { name: 'Branches' }).click();
  const branches = page.getByRole('dialog').filter({ hasText: 'New Branch Name' });
  await branches.getByPlaceholder('testing-branch').fill('bad name');
  await branches.getByRole('button', { name: 'Create', exact: true }).click();

  const alert = page.getByRole('dialog').filter({ hasText: 'would be an invalid git reference' });
  await expect(alert).toContainText('Create Branch Failed');
  await expect(alert).not.toContainText('Push Failed');
});
