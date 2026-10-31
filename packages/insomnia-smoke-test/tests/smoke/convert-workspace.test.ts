import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('a collection has tests, and converts to a design document and back @ci', async ({ page }) => {
  const specTab = page.getByRole('link', { name: 'spec', exact: true });
  const testTab = page.getByRole('link', { name: 'test', exact: true });

  // a collection's tests, with no spec
  await expect(specTab).toHaveCount(0);
  await testTab.click();
  await expect(page.getByRole('button', { name: 'New Test Suite' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Design Document' }).click();
  await expect(specTab).toBeVisible();
  await expect(page.getByText('start from an example')).toBeVisible();

  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Collection' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
  await expect(specTab).toHaveCount(0);
  await expect(page.getByLabel('Request Collection')).toBeVisible();
});
