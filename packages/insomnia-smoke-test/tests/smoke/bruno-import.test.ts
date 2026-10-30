import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

// a Bruno collection export: a request variable and two assertions
const collection = JSON.stringify({
  name: 'Bruno pets',
  version: '1',
  items: [{
    type: 'http-request',
    name: 'pet seven',
    seq: 1,
    request: {
      url: 'http://127.0.0.1:4010/pets/{{id}}',
      method: 'GET',
      headers: [],
      params: [],
      body: { mode: 'none' },
      vars: { req: [{ name: 'id', value: '7', enabled: true }] },
      assertions: [
        { name: 'res.status', value: 'eq 200', enabled: true },
        { name: 'res.body.id', value: 'eq "7"', enabled: true },
      ],
      auth: { mode: 'none' },
    },
  }],
  environments: [],
});

test('a Bruno collection imports with its assertions, which run on send @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await expect(page.getByRole('dialog')).toContainText('Bruno');
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pet seven');

  await expect(requestPane.getByRole('tab', { name: /Assertions/ })).toContainText('2');
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await responsePane.getByRole('tab', { name: /Tests/ }).click();
  await expect(responsePane.getByTestId('assertion-summary')).toHaveText('2 of 2 passed');
  await page.screenshot({ path: 'traces/bruno-import.png' });
});
