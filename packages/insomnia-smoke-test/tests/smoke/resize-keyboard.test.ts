import { expect, type Locator } from '@playwright/test';

import { test } from '../../playwright/test';

const valueOf = async (separator: Locator) => Number(await separator.getAttribute('aria-valuenow'));

test('the sidebar and panes resize from the keyboard @ci', async ({ page }) => {
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'HTTP Request' }).click();

  // the panes sit side by side or stacked, by the window's width: the keys follow
  const panes = page.getByRole('separator', { name: 'Resize the panes' });
  const forward = await panes.getAttribute('aria-orientation') === 'vertical' ? 'ArrowRight' : 'ArrowDown';
  const before = await valueOf(panes);
  await panes.focus();
  await page.keyboard.press(forward);
  await page.keyboard.press(forward);
  await expect.poll(() => valueOf(panes)).toBeGreaterThan(before);
  await page.keyboard.press('Home');
  await expect.poll(() => valueOf(panes)).toBe(Number(await panes.getAttribute('aria-valuemin')));
  await page.keyboard.press('End');
  await expect.poll(() => valueOf(panes)).toBe(Number(await panes.getAttribute('aria-valuemax')));

  const sidebar = page.getByRole('separator', { name: 'Resize the sidebar' });
  const filter = page.getByPlaceholder('Filter');
  const sidebarBefore = (await filter.boundingBox())!.width;
  await sidebar.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await filter.boundingBox())!.width).toBeLessThan(sidebarBefore);
});
