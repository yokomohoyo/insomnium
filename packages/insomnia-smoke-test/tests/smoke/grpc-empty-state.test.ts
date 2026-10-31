import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a new gRPC request says how to get to a method, not an HTTP body @ci', async ({ page }) => {
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'gRPC Request' }).click();
  await expect(page.getByText('Choose a method to call')).toBeVisible();
  await expect(page.getByText(/server reflection or a proto file/)).toBeVisible();
  await expect(page.getByText(/Select a body type/)).toHaveCount(0);
});
