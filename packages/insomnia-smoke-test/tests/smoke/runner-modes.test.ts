import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = JSON.stringify({
  info: { name: 'Runner modes', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet one', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/1' } }],
});

test("a run's report buttons stay with the run, not the load test @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'pet one' })).toBeVisible();

  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Run Collection' }).click();
  const runner = page.getByRole('dialog');
  await runner.getByRole('button', { name: /^Run \d+ requests?$/ }).click();
  await expect(runner.getByRole('button', { name: 'Save JUnit' })).toBeVisible();

  await runner.getByLabel('Load test').check();
  await expect(runner.getByRole('button', { name: 'Start the Load Test' })).toBeVisible();
  await expect(runner.getByRole('button', { name: 'Save JUnit' })).toHaveCount(0);

  // and back with the run
  await runner.getByLabel('Run', { exact: true }).check();
  await expect(runner.getByRole('button', { name: 'Save JUnit' })).toBeVisible();
});
