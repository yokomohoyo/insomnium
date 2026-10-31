import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test("clearing a collection's name in its settings doesn't leave it nameless @ci", async ({ page }) => {
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const name = page.getByRole('dialog').getByPlaceholder('Awesome API');
  await expect(name).toHaveValue('My Collection');

  await name.fill('');
  await name.press('Tab');
  await page.locator('.app').press('Escape');
  await expect(page.getByRole('button', { name: 'My Collection' })).toBeVisible();

  // a name typed after is saved, as before
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByPlaceholder('Awesome API').fill('Pets');
  await page.locator('.app').press('Escape');
  await expect(page.getByRole('button', { name: 'Pets' })).toBeVisible();
});
