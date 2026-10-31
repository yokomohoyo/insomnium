import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Console, scope: collection }
  - _id: req_1
    _type: request
    parentId: wrk_1
    name: pet one
    method: GET
    url: 'http://127.0.0.1:4010/pets/1'
    preRequestScript: "console.log('about to fetch pet one')"
`;

test('the console lists each send, with what its scripts logged @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pet one');

  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-testid="response-status-tag"]:visible')).toContainText('200');

  await page.getByTestId('console-button').click();
  const consolePane = page.getByRole('region', { name: 'Console', exact: true });
  const entry = consolePane.getByTestId('console-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('GET');
  await expect(entry).toContainText('200');
  await expect(entry).toContainText('pet one');
  await expect(entry).toContainText('1 log');
  await entry.getByRole('button').click();
  await expect(entry).toContainText('about to fetch pet one');

  await consolePane.getByRole('button', { name: 'Clear' }).click();
  await expect(entry).toHaveCount(0);
  // it records HTTP sends, and says so
  await expect(consolePane).toContainText('Each HTTP request you send shows here');
  await consolePane.getByRole('button', { name: 'Close the console' }).click();
  await expect(consolePane).toHaveCount(0);
});
