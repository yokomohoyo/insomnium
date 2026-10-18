import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const spec = `openapi: 3.0.0
info:
  title: Pet Sync
  version: 1.0.0
  description: Pets
servers:
  - url: http://127.0.0.1:4010
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      responses:
        '200':
          description: The pets
  /pets/{id}:
    get:
      operationId: getPet
      summary: Get a pet
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: A pet
`;

test('generating a collection again updates it instead of adding copies @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), spec);
  // from the collection the app opens in, to the project
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create in project' }).click();
  await page.getByRole('menuitemradio', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Pet Sync 1.0.0').click();

  const generate = page.getByRole('button', { name: 'Generate Request Collection' });
  await generate.click();
  const collection = page.getByLabel('Request Collection');
  await expect(collection.getByRole('row', { name: 'List pets' })).toHaveCount(1);
  await expect(collection.getByRole('row', { name: 'Get a pet' })).toHaveCount(1);

  await page.getByRole('link', { name: 'spec', exact: true }).click();
  await generate.click();
  const alert = page.getByRole('dialog');
  await expect(alert).toContainText('Request Collection Updated');
  await expect(alert).toContainText('Updated 0 requests and added 0; 2 already matched the spec.');
  await alert.getByRole('button', { name: 'Ok' }).click();

  await expect(collection.getByRole('row', { name: 'List pets' })).toHaveCount(1);
  await expect(collection.getByRole('row', { name: 'Get a pet' })).toHaveCount(1);
});
