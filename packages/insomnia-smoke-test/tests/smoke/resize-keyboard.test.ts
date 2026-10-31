import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('the sidebar and panes resize from the keyboard @ci', async ({ page }) => {
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'HTTP Request' }).click();
  const requestPane = page.getByTestId('request-pane');

  const panes = page.getByRole('separator', { name: 'Resize the panes' });
  const before = (await requestPane.boundingBox())!.width;
  await panes.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await requestPane.boundingBox())!.width).toBeGreaterThan(before + 10);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await requestPane.boundingBox())!.width).toBeLessThan(before / 4);
  await page.keyboard.press('End');
  await expect.poll(async () => (await requestPane.boundingBox())!.width).toBeGreaterThan(before * 1.5);

  const sidebar = page.getByRole('separator', { name: 'Resize the sidebar' });
  const filter = page.getByPlaceholder('Filter');
  const sidebarBefore = (await filter.boundingBox())!.width;
  await sidebar.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await filter.boundingBox())!.width).toBeLessThan(sidebarBefore);
});
