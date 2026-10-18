import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Load, scope: collection }
  - { _id: req_1, _type: request, parentId: wrk_1, name: pet one, method: GET, url: 'http://127.0.0.1:4010/pets/1', metaSortKey: 1 }
  - { _id: req_2, _type: request, parentId: wrk_1, name: missing, method: GET, url: 'http://127.0.0.1:4010/nothing-here', metaSortKey: 2 }
`;

test('the runner load tests a collection with virtual users @ci', async ({ app, page }) => {
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
  await runner.getByLabel('Load test').check();
  await runner.getByLabel('Virtual users').fill('3');
  await runner.getByLabel('Duration (s)').fill('3');
  await runner.getByRole('button', { name: 'Start the Load Test' }).click();
  await expect(runner.getByRole('button', { name: 'Stop' })).toBeVisible();

  const summary = runner.getByTestId('load-summary');
  await expect(summary).not.toContainText('Running', { timeout: 15_000 });
  const results = runner.getByRole('table', { name: 'Load test results' });
  const petOne = results.getByRole('row', { name: 'pet one' });
  const missing = results.getByRole('row', { name: 'missing' });
  await expect(petOne).toBeVisible();
  // every 404 fails; every pet one passes
  const sent = Number(await missing.locator('td').nth(1).textContent());
  expect(sent).toBeGreaterThan(0);
  await expect(missing.locator('td').nth(2)).toHaveText(String(sent));
  await expect(petOne.locator('td').nth(2)).toHaveText('0');
  await expect(runner.getByRole('list', { name: 'Load test failures' })).toContainText('HTTP 404');
  await expect(summary).toContainText('requests');
});
