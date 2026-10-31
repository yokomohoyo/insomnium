import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a repository on this computer takes an author and an address to push to later @ci', async ({ page }) => {
  // Git Sync with no remote
  await page.getByRole('button', { name: 'Git Sync' }).click();
  await page.getByRole('menuitem', { name: 'Setup Git Sync' }).click();
  await page.locator('input[name="authorName"]').fill('Kim');
  await page.locator('input[name="authorEmail"]').fill('kim@example.com');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();

  const gitMenu = page.getByTestId('git-dropdown').locator('button');
  const openSettings = async () => {
    await gitMenu.click();
    await page.getByRole('menuitem', { name: 'Repository Settings' }).click();
  };

  await openSettings();
  await page.locator('input[name="authorName"]').fill('Lee');
  await page.locator('input[name="uri"]').fill('https://example.com/org/repo.git');
  await page.getByTestId('git-repository-settings-modal__save-btn').click();
  await expect(page.getByTestId('git-repository-settings-modal__save-btn')).toBeHidden();

  await openSettings();
  await expect(page.locator('input[name="authorName"]')).toHaveValue('Lee');
  await expect(page.locator('input[name="uri"]')).toHaveValue('https://example.com/org/repo.git');
  await expect(page.locator('input[name="uri"]')).toBeDisabled();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();

  // with an address, there's somewhere to push to
  await gitMenu.click();
  await expect(page.getByRole('menuitem', { name: 'Push' })).toBeVisible();
});
