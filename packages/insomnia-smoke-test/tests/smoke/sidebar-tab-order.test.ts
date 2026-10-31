import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('tabbing past the sidebar buttons reaches the requests @ci', async ({ page }) => {
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'HTTP Request' }).click();

  // filter, then sort and create; with nothing pinned, the next stop is the request
  await page.getByPlaceholder('Filter').click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Create in collection')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Request Collection').locator('[role="row"]:focus')).toHaveCount(1);
});
