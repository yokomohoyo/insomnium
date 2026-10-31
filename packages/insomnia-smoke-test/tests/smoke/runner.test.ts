import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// a folder of two requests: one passes its assertions, one doesn't
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Runner, scope: collection }
  - { _id: fld_1, _type: request_group, parentId: wrk_1, name: Pets }
  - _id: req_1
    _type: request
    parentId: fld_1
    name: pet one
    method: GET
    url: 'http://127.0.0.1:4010/pets/1'
    metaSortKey: 1
    assertions: [{ id: a1, source: status, operator: equals, value: '200' }, { id: a2, source: jsonpath, property: $.id, operator: equals, value: '1' }]
  - _id: req_2
    _type: request
    parentId: fld_1
    name: pet two
    method: GET
    url: 'http://127.0.0.1:4010/pets/2'
    metaSortKey: 2
    assertions: [{ id: a1, source: jsonpath, property: $.id, operator: equals, value: '3' }]
`;

test('the runner sends a folder in order and reports its assertions @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  const folder = page.getByLabel('Request Collection').getByRole('row', { name: 'Pets' });
  await folder.getByLabel('Request Group Actions').click();
  await page.getByRole('menuitemradio', { name: 'Run Folder' }).click();
  const runner = page.getByRole('dialog');
  await expect(runner.getByRole('list', { name: 'Requests to run' })).toContainText('Pets / pet one');
  await runner.getByRole('button', { name: 'Run 2 requests' }).click();

  await expect(runner.getByTestId('run-summary')).toHaveText(/^1 of 2 requests passed · 2 of 3 assertions passed/);
  const results = runner.getByRole('list', { name: 'Run results' });
  await expect(results.getByRole('listitem').nth(0)).toContainText('Pets / pet one');
  await results.getByRole('listitem', { name: 'Pets / pet two' }).locator('summary').click();
  await expect(results).toContainText('JSON path $.id equals 3: got "2"');

  // each request over the run: its numbers, and where its time went
  const stats = runner.getByRole('table', { name: 'Each request over the run' });
  const petTwo = stats.getByRole('row', { name: 'Pets / pet two' });
  await expect(petTwo.getByRole('cell').nth(1)).toHaveText('1');
  await expect(petTwo.getByRole('cell').nth(2)).toHaveText('1');
  await expect(petTwo.getByRole('img')).toHaveAttribute('aria-label', /^DNS lookup .* ms, Connecting .* ms, Waiting \(time to first byte\) .* ms, Download .* ms$/);
  for (const report of ['Save HTML', 'Save CSV', 'Save JSON', 'Save JUnit']) {
    await expect(runner.getByRole('button', { name: report })).toBeVisible();
  }
  await page.screenshot({ path: 'traces/runner.png' });
});
