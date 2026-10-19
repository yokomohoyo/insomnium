import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a stash keeps a change aside and brings it back, and a tag goes on the current commit @ci', async ({ page }) => {
  const gitMenu = page.getByTestId('git-dropdown').locator('button');
  const methodButton = page.getByTestId('request-pane').locator('.method-dropdown button');
  const setMethod = async (method: string) => {
    await methodButton.click();
    await page.getByRole('menuitem', { name: method, exact: true }).click();
    await expect(methodButton).toContainText(method);
  };

  // a repository on this computer, with a first commit
  await page.getByRole('button', { name: 'Git Sync' }).click();
  await page.getByRole('menuitem', { name: 'Setup Git Sync' }).click();
  await page.locator('input[name="authorName"]').fill('Kim');
  await page.locator('input[name="authorEmail"]').fill('kim@example.com');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByTestId('git-repository-settings-modal__sync-btn-close').click();
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Commit' }).click();
  const commitDialog = page.getByRole('dialog');
  await commitDialog.getByPlaceholder('A descriptive message to describe changes made').fill('first');
  await commitDialog.locator('input[name="allUnversioned"]').check();
  await commitDialog.getByRole('button', { name: 'Commit' }).click();
  await expect(commitDialog).toContainText('Commited. Ready to push');
  await commitDialog.getByRole('button', { name: 'Close' }).click();

  // a change, stashed: it's undone here
  await setMethod('POST');
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Stashes' }).click();
  const stashes = page.getByRole('dialog').filter({ hasText: 'Stashes' });
  await stashes.getByPlaceholder('Half done').fill('trying POST');
  await stashes.getByRole('button', { name: 'Stash 1 Change' }).click();
  const stash = stashes.getByTestId('git-stash');
  await expect(stash).toContainText('trying POST');
  await expect(stash).toContainText('New Request');
  await expect(methodButton).toContainText('GET');

  // and popped: back, and the stash gone
  await stash.getByRole('button', { name: 'Pop' }).click();
  await expect(stash).toHaveCount(0);
  await expect(methodButton).toContainText('POST');
  await stashes.getByRole('button', { name: 'Done' }).click();

  // a tag, with a message, on the commit
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Tags' }).click();
  const tags = page.getByRole('dialog').filter({ hasText: 'Tags' });
  await tags.getByPlaceholder('v1.0.0').fill('v1.0.0');
  await tags.getByPlaceholder('The first release').fill('the first one');
  await tags.getByRole('button', { name: /^Tag / }).click();
  const tag = tags.getByTestId('git-tag');
  await expect(tag).toContainText('v1.0.0');
  await expect(tag).toContainText('the first one');
  await expect(tag).toContainText('(current)');
  // no remote here, so nothing to push to
  await expect(tag.getByRole('button', { name: 'Push' })).toHaveCount(0);
  await tags.getByRole('button', { name: 'Done' }).click();
});
