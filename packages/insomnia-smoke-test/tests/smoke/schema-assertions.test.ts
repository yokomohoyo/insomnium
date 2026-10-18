import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// the pets route answers { "id": "<id>" }
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Schemas, scope: collection }
  - _id: req_1
    _type: request
    parentId: wrk_1
    name: checked pet
    method: GET
    url: http://127.0.0.1:4010/pets/7
    assertions:
      - { id: a1, source: body, operator: matchesSchema, value: '{"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}}' }
      - { id: a2, source: jsonpath, property: $.id, operator: matchesSchema, value: '{"type": "integer"}' }
`;

test('a JSON Schema assertion checks the response in the app @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'checked pet' }).click();

  await requestPane.getByRole('button', { name: 'Send' }).click();
  await responsePane.getByRole('tab', { name: /Tests/ }).click();
  await expect(responsePane.getByTestId('assertion-summary')).toHaveText('1 of 2 passed');
  await expect(responsePane.getByRole('list', { name: 'Assertion results' })).toContainText('JSON path $.id matches JSON schema: the value must be integer');
  await page.screenshot({ path: 'traces/schema-assertions.png' });
});
