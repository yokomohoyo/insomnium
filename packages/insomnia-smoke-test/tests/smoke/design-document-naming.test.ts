import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('can name design documents @ci', async ({ page }) => {
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create in project' }).click();
  await page.getByRole('menuitemradio', { name: 'Design document' }).click();
  await page.getByPlaceholder('my-spec.yaml').fill('jurassic park');
  await page.getByPlaceholder('my-spec.yaml').press('Enter');
  await page.getByTestId('project').click();
  await expect(page.getByLabel('Workspaces').getByRole('row', { name: 'jurassic park' })).toBeVisible();
});
