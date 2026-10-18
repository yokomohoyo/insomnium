import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Tabs', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    { name: 'list pets', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets' } },
    { name: 'add owner', request: { method: 'POST', url: 'http://127.0.0.1:4010/owners' } },
  ],
});

test('requests open as tabs, to switch between and close @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  const sidebar = page.getByLabel('Request Collection');
  await sidebar.getByRole('row', { name: 'list pets' }).click();
  await sidebar.getByRole('row', { name: 'add owner' }).click();

  const tabs = page.getByLabel('Open requests').getByTestId('request-tab');
  const pets = tabs.filter({ hasText: 'list pets' });
  const owner = tabs.filter({ hasText: 'add owner' });
  await expect(pets).toHaveCount(1);
  await expect(owner).toHaveAttribute('aria-current', 'page');

  // back to the first, from its tab
  await pets.getByRole('link').click();
  await expect(pets).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('request-pane')).toContainText('http://127.0.0.1:4010/pets');

  // closing another tab keeps this request; closing this one shows its neighbour
  await page.getByRole('button', { name: 'Close add owner' }).click();
  await expect(owner).toHaveCount(0);
  await expect(pets).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Close list pets' }).click();
  await expect(pets).toHaveCount(0);

  // opening it again brings its tab back
  await sidebar.getByRole('row', { name: 'list pets' }).click();
  await expect(pets).toHaveAttribute('aria-current', 'page');
});
