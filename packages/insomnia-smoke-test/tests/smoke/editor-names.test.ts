import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('the URL bar and the editors have names @ci', async ({ page }) => {
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'HTTP Request' }).click();
  const requestPane = page.getByTestId('request-pane');

  const url = requestPane.getByRole('textbox', { name: 'URL', exact: true });
  await expect(url).toHaveCount(1);
  await url.fill('http://127.0.0.1:4010/pets/1');
  await requestPane.getByRole('button', { name: 'Send' }).click();

  const responsePane = page.getByTestId('response-pane');
  await expect(responsePane).toContainText('"id": "1"');
  await expect(responsePane.getByRole('textbox', { name: 'Response body' })).toHaveCount(1);
});
