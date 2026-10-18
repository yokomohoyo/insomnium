import { test } from '../../playwright/test';
test('Clone from github', async ({ page }) => {
  await page.getByRole('button', { name: 'Git Clone' }).click();
  await page.getByRole('tab', { name: ' Git' }).click();
  await page.getByPlaceholder('https://github.com/org/repo.git').fill('https://github.com/gatzjames/insomnia-git-example.git');
  await page.getByPlaceholder('Name').fill('J');
  await page.getByPlaceholder('Email').fill('J');
  await page.getByPlaceholder('MyUser').fill('J');
  await page.getByPlaceholder('88e7ee63b254e4b0bf047559eafe86ba9dd49507').fill('J');
  await page.getByTestId('git-repository-settings-modal__sync-btn').click();
  await page.getByRole('button', { name: 'Toggle Preview' }).click();
});
