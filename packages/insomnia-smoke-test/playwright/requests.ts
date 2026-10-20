import { expect, type Page } from '@playwright/test';

// A request opened from the collection's sidebar. The window shows it once its
// row is selected (the selection is the route's), so a Send clicked then goes
// to it, not to the request that was open before.
export async function openRequest(page: Page, name: string) {
  const row = page.getByLabel('Request Collection').getByRole('row', { name });
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
}
