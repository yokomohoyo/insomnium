import { expect } from '@playwright/test';

import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test('event stream sends rendered headers and auth', async ({ app, page }) => {
  const statusTag = page.locator('[data-testid="response-status-tag"]:visible');
  const responseBody = page.locator('[data-testid="CodeEditor"]:visible', {
    has: page.locator('.CodeMirror-activeline'),
  });

  // the app opens in My Collection; import the smoke requests into it
  const text = await loadFixture('smoke-test-collection.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  await page.getByLabel('Request Collection').getByRole('row', { name: 'connects to event stream with rendered headers and auth' }).click();
  await page.getByTestId('request-pane').getByRole('button', { name: 'Connect' }).click();
  await expect(statusTag).toContainText('200 OK');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  // libcurl 8 says 'Established connection to', 7.x said 'Connected to'
  await expect(responseBody).toContainText(/(Connected to|Established connection to) 127.0.0.1/);
  await expect(responseBody).toContainText('Authorization: Bearer smoke-token');
  await expect(responseBody).toContainText('X-Rendered: c21va2U=');
  await expect(responseBody).not.toContainText('should-not-be-sent');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Disconnect' }).click();
});
