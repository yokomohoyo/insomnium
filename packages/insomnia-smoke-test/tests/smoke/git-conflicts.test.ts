import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a merge where both branches changed a request lets you choose which to keep @ci', async ({ page }) => {
  const gitMenu = page.getByTestId('git-dropdown').locator('button');
  const methodButton = page.getByTestId('request-pane').locator('.method-dropdown button');
  const commit = async (message: string, everything = false) => {
    await gitMenu.click();
    await page.getByRole('menuitem', { name: 'Commit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('A descriptive message to describe changes made').fill(message);
    if (everything) {
      await dialog.locator('input[name="allUnversioned"]').check();
    }
    await dialog.getByRole('button', { name: 'Commit' }).click();
    await expect(dialog).toContainText('Committed.');
    await dialog.getByRole('button', { name: 'Close' }).click();
  };
  const setMethod = async (method: string) => {
    await methodButton.click();
    await page.getByRole('menuitem', { name: method, exact: true }).click();
    await expect(methodButton).toContainText(method);
  };
  const branches = page.getByRole('dialog').filter({ has: page.getByPlaceholder('testing-branch') });
  const openBranches = async () => {
    await gitMenu.click();
    await page.getByRole('menuitem', { name: 'Branches' }).click();
  };

  // a repository on this computer, with a first commit
  await page.getByRole('button', { name: 'Git Sync' }).click();
  await page.getByRole('menuitem', { name: 'Setup Git Sync' }).click();
  await page.locator('input[name="authorName"]').fill('Kim');
  await page.locator('input[name="authorEmail"]').fill('kim@example.com');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();
  await commit('first', true);

  // their branch makes the request a POST
  await openBranches();
  await branches.getByPlaceholder('testing-branch').fill('theirs');
  await branches.getByRole('button', { name: 'Create' }).click();
  // a new branch is checked out, and the workspace shown afresh on it
  await expect(branches).toHaveCount(0);
  await expect(page.getByTestId('git-dropdown')).toContainText('theirs');
  await setMethod('POST');
  await commit('post');

  // and main makes it a PUT
  await openBranches();
  await branches.getByRole('row').filter({ hasText: 'main' }).getByRole('button', { name: 'Checkout' }).click();
  await expect(branches).toHaveCount(0);
  await expect(page.getByTestId('git-dropdown')).toContainText('main');
  await expect(methodButton).toContainText('GET');
  await setMethod('PUT');
  await commit('put');

  // merging theirs asks which to keep
  await openBranches();
  const theirs = branches.getByRole('row').filter({ hasText: 'theirs' });
  await theirs.getByRole('button', { name: 'Merge' }).click();
  await theirs.getByRole('button', { name: /Click to confirm/ }).click();
  const conflict = page.getByTestId('git-conflict');
  await expect(conflict).toContainText('New Request');
  await expect(conflict).toContainText('method');
  await expect(conflict).toContainText('PUT');
  await expect(conflict).toContainText('POST');
  await conflict.getByLabel('Take theirs').check();
  await page.getByRole('dialog').filter({ hasText: 'Changed on Both Sides' }).getByRole('button', { name: 'Merge' }).click();
  await expect(conflict).toHaveCount(0);
  await branches.getByRole('button', { name: 'Done' }).click();

  // on main still, with their method
  await expect(page.getByTestId('git-dropdown')).toContainText('main');
  await expect(methodButton).toContainText('POST');
});
