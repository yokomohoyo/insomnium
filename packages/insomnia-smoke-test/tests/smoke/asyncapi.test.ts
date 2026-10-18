import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const spec = `asyncapi: 3.0.0
info:
  title: Orders
  version: 1.2.0
servers:
  production:
    host: broker.example.com:9092
    protocol: kafka
channels:
  orderPlaced:
    address: orders/placed
    messages:
      OrderPlaced:
        payload:
          type: object
          properties:
            id:
              type: string
operations:
  publishOrder:
    action: send
    channel:
      $ref: '#/channels/orderPlaced'
`;

const document = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Orders', scope: 'design' },
    { _id: 'spc_1', _type: 'api_spec', parentId: 'wrk_1', fileName: 'Orders', contentType: 'yaml', contents: spec },
  ],
});

test('an AsyncAPI document is linted with the AsyncAPI rules and previewed @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), document);
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create in project' }).click();
  await page.getByRole('menuitemradio', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Orders', { exact: true }).click();
  await page.getByRole('link', { name: 'spec', exact: true }).click();

  const preview = page.getByTestId('asyncapi-preview');
  await expect(preview).toContainText('AsyncAPI 3.0.0');
  await expect(preview).toContainText('broker.example.com:9092');
  await expect(preview.getByRole('region', { name: 'orders/placed' })).toContainText('SEND publishOrder');
  await preview.getByText('OrderPlaced').click();
  await expect(preview).toContainText('"type": "string"');

  await expect(page.locator('.pane-one')).toContainText('asyncapi-info-contact');
  await expect(page.getByRole('button', { name: 'Generate Request Collection' })).toBeDisabled();
});
