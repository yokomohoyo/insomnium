import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

// a Postman collection whose request uses a dynamic variable
const collection = JSON.stringify({
  info: { name: 'Dynamic variables', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet by guid', request: { method: 'GET', url: 'http://127.0.0.1:4010/pets/{{$guid}}' } }],
});

test("Postman's dynamic variables import as faker tags and render on send @ci", async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pet by guid');

  await requestPane.getByRole('button', { name: 'Send' }).click();
  // the server echoes the id it was sent: a fresh v4 UUID
  await expect(responsePane).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
  await page.screenshot({ path: 'traces/faker.png' });
});
