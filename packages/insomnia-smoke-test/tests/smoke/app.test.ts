import { expect } from '@playwright/test';

import { importIntoCollection } from '../../playwright/import';
import { loadFixture } from '../../playwright/paths';
import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

test('can send requests @ci', async ({ app, page }) => {
  test.slow(process.platform === 'darwin' || process.platform === 'win32', 'Slow app start on these platforms');
  const statusTag = page.locator('[data-testid="response-status-tag"]:visible');
  const responseBody = page.locator('[data-testid="CodeEditor"]:visible', {
    has: page.locator('.CodeMirror-activeline'),
  });

  await importIntoCollection(app, page, await loadFixture('smoke-test-collection.yaml'));

  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  await page.getByRole('dialog').getByRole('checkbox').nth(1).uncheck();
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Which format would you like to export as?')).toBeVisible();
  await page.locator('.app').press('Escape');

  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'From Curl' }).click();
  await page.getByRole('dialog').locator('.CodeMirror textarea').fill('curl --request GET --url http://127.0.0.1:4010/pets/1');
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(statusTag).toContainText('200 OK');

  await openRequest(page, 'send JSON request');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(statusTag).toContainText('200 OK');
  await expect(responseBody).toContainText('"id": "1"');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('menuitem', { name: 'Raw Data' }).click();
  await expect(responseBody).toContainText('{"id":"1"}');

  await openRequest(page, 'connects to event stream and shows ping response');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Connect' }).click();
  await expect(statusTag).toContainText('200 OK');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(responseBody).toContainText('> GET /events HTTP/1.1');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Disconnect' }).click();

  await openRequest(page, 'sends dummy.csv request and shows rich response');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(statusTag).toContainText('200 OK');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('menuitem', { name: 'Raw Data' }).click();
  await expect(responseBody).toContainText('a,b,c');

  await openRequest(page, 'sends dummy.xml request and shows raw response');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(statusTag).toContainText('200 OK');
  await expect(responseBody).toContainText('xml version="1.0"');
  await expect(responseBody).toContainText('<LoginResult>');

  await openRequest(page, 'sends dummy.pdf request and shows rich response');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(statusTag).toContainText('200 OK');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(responseBody).toContainText('< Content-Type: application/pdf');

  await openRequest(page, 'sends request with basic authentication');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(statusTag).toContainText('200 OK');
  await expect(responseBody).toContainText('basic auth received');

  await openRequest(page, 'sends request with cookie and get cookie in response');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(statusTag).toContainText('200 OK');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(responseBody).toContainText('Set-Cookie: insomnia-test-cookie=value123');
});

// This feature is unsafe to place beside other tests, cancelling a request can cause network code to block
// related to https://linear.app/insomnia/issue/INS-973
test('can cancel requests @ci', async ({ app, page }) => {
  await importIntoCollection(app, page, await loadFixture('smoke-test-collection.yaml'));

  await openRequest(page, 'delayed request');
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();

  await page.getByRole('button', { name: 'Cancel Request' }).click();
  await expect(page.getByText('Request was cancelled')).toBeVisible();
});
