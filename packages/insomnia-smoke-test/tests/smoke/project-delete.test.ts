import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('deleting a project from its menu asks first, as it takes its collections with it @ci', async ({ page }) => {
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create new Project' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.app')).toContainText('This is an empty project');

  const project = page.getByRole('row', { name: 'My Project' });
  await project.getByRole('button', { name: 'Project Actions' }).click();
  await page.getByRole('menuitemradio', { name: 'Delete' }).click();
  const ask = page.getByRole('dialog');
  await expect(ask).toContainText('Do you really want to delete "My Project"');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(project).toBeVisible();

  await project.getByRole('button', { name: 'Project Actions' }).click();
  await page.getByRole('menuitemradio', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes' }).click();
  await expect(project).toHaveCount(0);
});
