import { expect } from '@playwright/test';

import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test('assertions are saved with the request and checked on send', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  // the app opens in My Collection; import the smoke requests into it
  const text = await loadFixture('smoke-test-collection.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'send JSON request' }).click();

  await requestPane.getByRole('tab', { name: /Assertions/ }).click();
  const add = requestPane.getByRole('button', { name: 'Add assertion' });
  // 1: the default, status equals 200
  await add.click();
  // 2: a JSON path on the body ({ "id": "1" })
  await add.click();
  const second = requestPane.getByRole('listitem', { name: 'Assertion 2' });
  await second.getByLabel('Source').selectOption('jsonpath');
  await second.getByLabel('Property').fill('$.id');
  await second.getByLabel('Expected').fill('1');
  // 3: one that fails
  await add.click();
  await requestPane.getByRole('listitem', { name: 'Assertion 3' }).getByLabel('Expected').fill('404');
  await expect(requestPane.getByRole('tab', { name: /Assertions/ })).toContainText('3');
  await page.screenshot({ path: 'traces/assertions-editor.png' });

  // they were saved: they come back after leaving the tab
  await requestPane.getByRole('tab', { name: /Headers/ }).click();
  await requestPane.getByRole('tab', { name: /Assertions/ }).click();
  await expect(requestPane.getByRole('listitem', { name: 'Assertion 2' }).getByLabel('Property')).toHaveValue('$.id');
  await expect(requestPane.getByRole('listitem', { name: 'Assertion 3' }).getByLabel('Expected')).toHaveValue('404');

  await requestPane.getByRole('button', { name: 'Send' }).click();
  await responsePane.getByRole('tab', { name: /Tests/ }).click();
  await expect(responsePane.getByTestId('assertion-summary')).toHaveText('2 of 3 passed');
  await expect(responsePane.getByRole('list', { name: 'Assertion results' })).toContainText('Status code equals 404: got "200"');
  await page.screenshot({ path: 'traces/assertions-results.png' });
});
