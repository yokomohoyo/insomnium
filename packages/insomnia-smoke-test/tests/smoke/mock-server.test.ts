import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// a request with two examples
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Mocked, scope: collection }
  - { _id: req_1, _type: request, parentId: wrk_1, name: get pet, method: GET, url: '{{ base_url }}/pets/:id' }
  - _id: ex_1
    _type: response_example
    parentId: req_1
    name: Found
    statusCode: 200
    statusMessage: OK
    headers: [{ name: Content-Type, value: application/json }]
    body: '{"id": 1, "name": "Rex"}'
  - _id: ex_2
    _type: response_example
    parentId: req_1
    name: Missing
    statusCode: 404
    statusMessage: Not Found
    headers: []
    body: 'no pet'
`;

test("a collection's mock server answers with its examples @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Mock Server' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'Mocked routes' })).toContainText('/pets/:id');
  // any free port
  await dialog.getByLabel('Port').fill('0');
  await dialog.getByRole('button', { name: 'Start' }).click();
  const url = await dialog.getByTestId('mock-server-url').textContent();

  const found = await fetch(`${url}/pets/1`);
  expect([found.status, await found.json()]).toEqual([200, { id: 1, name: 'Rex' }]);
  const missing = await fetch(`${url}/pets/1`, { headers: { 'x-mock-response-name': 'Missing' } });
  expect([missing.status, await missing.text()]).toEqual([404, 'no pet']);

  await expect(dialog.getByRole('list', { name: 'Mock requests' })).toContainText('get pet · Missing');
  await page.screenshot({ path: 'traces/mock-server.png' });
  await dialog.getByRole('button', { name: 'Stop' }).click();
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeVisible();
});
