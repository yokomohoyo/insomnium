import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';

import { test } from '../../playwright/test';

// the smoke server's example.git: two commits on main, and pushes take smoke:token
test('clones a repository over HTTP, branches, and pushes once the token is put right @ci', async ({ page }) => {
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create in project' }).click();
  await page.getByRole('menuitemradio', { name: 'Git Clone' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Git URI').fill('http://127.0.0.1:4010/git/example.git');
  await dialog.getByLabel('Author Name').fill('Kim');
  await dialog.getByLabel('Author Email').fill('kim@example.com');
  await dialog.getByLabel('Username').fill('smoke');
  await dialog.getByLabel('Authentication Token').fill('wrong');
  await dialog.getByRole('button', { name: 'Clone' }).click();
  await expect(page.getByRole('button', { name: 'example.git' })).toBeVisible();

  // its history came with it
  const gitMenu = page.getByTestId('git-dropdown').locator('button');
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'History' }).click();
  await expect(dialog.getByRole('cell', { name: 'second commit' })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'first commit' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // a new branch (one of its own, as the server lives on between runs), pushed with the wrong token
  const branch = `test-${Date.now()}`;
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Branches' }).click();
  await dialog.getByPlaceholder('testing-branch').fill(branch);
  await dialog.getByRole('button', { name: '+ Create' }).click();
  // made and checked out
  await expect(page.getByTestId('git-dropdown')).toContainText(branch);
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Push' }).click();
  await expect(dialog).toContainText('Push Failed');
  await expect(dialog).toContainText('401 Unauthorized');
  await dialog.getByRole('button', { name: 'Ok' }).click();

  // the right token, in the repository's settings, and the push goes through
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Repository Settings' }).click();
  await expect(dialog.getByLabel('Git URI')).toBeDisabled();
  await dialog.getByLabel('Authentication Token').fill('token');
  await dialog.getByTestId('git-repository-settings-modal__save-btn').click();
  await expect(dialog).toHaveCount(0);
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Push' }).click();
  // the branch is on the server now
  const branches = () => execFileSync('git', ['ls-remote', '--heads', 'http://127.0.0.1:4010/git/example.git']).toString();
  await expect.poll(branches).toContain(`refs/heads/${branch}`);
});
