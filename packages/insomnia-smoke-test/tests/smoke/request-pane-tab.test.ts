import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('Request tabs @ci', async ({ page }) => {
  const requestPane = page.getByTestId('request-pane');
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'HTTP Request' }).click();
  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'New Request' })).toHaveCount(2);

  await requestPane.getByRole('button', { name: 'Body' }).click();
  await page.getByRole('menuitem', { name: 'JSON' }).click();
  await requestPane.getByRole('tab', { name: /Auth/ }).click();
  await requestPane.getByRole('button', { name: /Auth/ }).click();
  await page.getByRole('menuitem', { name: 'OAuth 1.0' }).click();
  await expect(requestPane.getByRole('tabpanel')).toContainText('OAuth 1.0');
  await requestPane.getByRole('tab', { name: 'Query' }).click();
  await requestPane.getByRole('tab', { name: /Headers/ }).click();
  await requestPane.getByRole('tab', { name: 'Docs' }).click();
  await requestPane.getByRole('button', { name: 'Add Description' }).click();
  // the description is written in the request's settings
  await page.getByRole('dialog').getByRole('tabpanel', { name: 'Write' }).locator('.CodeMirror').click();
  await page.keyboard.insertText('new request');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await expect(requestPane.getByRole('tabpanel')).toContainText('new request');
});

test('WS tabs @ci', async ({ page }) => {
  const requestPane = page.getByTestId('request-pane');
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'WebSocket Request' }).click();
  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'New WebSocket Request' })).toHaveAttribute('aria-selected', 'true');

  await requestPane.getByRole('button', { name: /^JSON/ }).click();
  await page.getByRole('menuitem', { name: 'JSON' }).click();
  await requestPane.getByRole('tab', { name: /Auth/ }).click();
  await requestPane.getByRole('tab', { name: 'Query' }).click();
  await requestPane.getByRole('tab', { name: /Headers/ }).click();
  await requestPane.getByRole('tab', { name: 'Docs' }).click();
  await requestPane.getByRole('button', { name: 'Add Description' }).click();
  // the description is written in the request's settings
  await page.getByRole('dialog').getByRole('tabpanel', { name: 'Write' }).locator('.CodeMirror').click();
  await page.keyboard.insertText('new wss');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await expect(requestPane.getByRole('tabpanel')).toContainText('new wss');
});
