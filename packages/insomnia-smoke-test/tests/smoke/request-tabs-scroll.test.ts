import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const names = Array.from({ length: 12 }, (_, i) => `pets request with a long name ${i + 1}`);
const collection = JSON.stringify({
  info: { name: 'Many tabs', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: names.map(name => ({ name, request: { method: 'GET', url: 'http://127.0.0.1:4010/pets' } })),
});

test("the open request's tab scrolls into view @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  const sidebar = page.getByLabel('Request Collection');
  const tabs = page.getByLabel('Open requests').getByTestId('request-tab');
  for (const name of names) {
    await sidebar.getByRole('row', { name, exact: true }).click();
    await expect(tabs.filter({ hasText: name })).toHaveAttribute('aria-current', 'page');
  }
  // more tabs than fit: the last one opened is still in view
  await expect(tabs.last()).toBeInViewport();

  // and switching back to the first scrolls back to it
  await sidebar.getByRole('row', { name: names[0], exact: true }).click();
  // (the first tab is the app's own New Request)
  const first = tabs.filter({ hasText: new RegExp(`${names[0]}$`) });
  await expect(first).toHaveAttribute('aria-current', 'page');
  await expect(first).toBeInViewport();
});
