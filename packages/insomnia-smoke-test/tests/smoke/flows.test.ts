import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// a pet, and a pet by the id a variable gives
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Flows, scope: collection }
  - { _id: req_1, _type: request, parentId: wrk_1, name: pet one, method: GET, url: 'http://127.0.0.1:4010/pets/1', metaSortKey: 1 }
  - { _id: req_2, _type: request, parentId: wrk_1, name: pet by id, method: GET, url: 'http://127.0.0.1:4010/pets/{{ petId }}', metaSortKey: 2 }
`;

test('a flow sends its requests in order, branching on a response and carrying a variable to the next @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'pet by id' })).toBeVisible();

  await page.getByRole('link', { name: 'flows', exact: true }).click();
  await page.getByRole('button', { name: 'New Flow' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create Flow' }).click();

  // each step goes after the one selected: Start, then each one added
  const toolbar = page.getByRole('toolbar', { name: 'Flow' });
  const step = page.getByRole('region', { name: 'Step' });
  await toolbar.getByRole('button', { name: 'Request' }).click();
  await step.getByLabel('Request').selectOption({ label: 'GET pet one' });
  // status equals 200, as a condition starts
  await toolbar.getByRole('button', { name: 'Condition' }).click();
  await expect(step.getByLabel('Checks')).toHaveValue('status');
  await toolbar.getByRole('button', { name: 'Set Variable' }).click();
  await step.getByLabel('Name', { exact: true }).fill('petId');
  await step.getByLabel('Value from').selectOption('jsonpath');
  await step.getByLabel('JSON path').fill('$.id');
  await toolbar.getByRole('button', { name: 'Request' }).click();
  await step.getByLabel('Request').selectOption({ label: 'GET pet by id' });
  await expect(page.getByTestId('flow-node-request')).toHaveCount(2);

  await toolbar.getByRole('button', { name: 'Run Flow' }).click();
  const run = page.getByRole('region', { name: 'Run' });
  await expect(run.getByRole('status')).toHaveText('Done');
  const steps = run.getByRole('listitem');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(2)).toContainText('Status code equals 200');
  await expect(steps.nth(3)).toContainText('petId = "1"');
  await expect(steps.nth(4)).toContainText('pet by id');
  await expect(steps.nth(4)).toContainText('200 OK');
  await expect(run.getByRole('table')).toContainText('petId');
  await page.screenshot({ path: 'traces/flows.png' });

  // the flow was saved: it's there after leaving and coming back
  await page.getByTestId('back-to-requests').click();
  await expect(page.getByRole('link', { name: 'requests', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'flows', exact: true }).click();
  await page.getByRole('list', { name: 'Flows' }).getByRole('button', { name: 'New Flow' }).click();
  await expect(page.getByTestId('flow-node-request')).toHaveCount(2);
  await expect(page.getByTestId('flow-node-setVariable')).toContainText('petId');
});
