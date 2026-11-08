import { expect, Locator } from '@playwright/test';

import { importIntoCollection } from '../../playwright/import';
import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test.describe('gRPC interactions', () => {

  test.slow(process.platform === 'darwin' || process.platform === 'win32', 'Slow app start on these platforms');
  let statusTag: Locator;
  let responseBody: Locator;
  let streamMessage: Locator;

  test.beforeEach(async ({ app, page }) => {
    await importIntoCollection(app, page, await loadFixture('grpc.yaml'));
    statusTag = page.locator('[data-testid="response-status-tag"]:visible');
    responseBody = page.locator('[data-testid="response-pane"] >> [data-testid="CodeEditor"]:visible', {
      has: page.locator('.CodeMirror-activeline'),
    });
    streamMessage = page.locator('[data-testid="request-pane"] button:has-text("Stream")');
    await page.getByLabel('Request Collection').getByRole('row', { name: 'Route Guide Example' }).click();
  });

  test('can send unidirectional requests @ci', async ({ page }) => {
    await page.getByLabel('Request Collection').getByText('Unary', { exact: true }).click();
    await page.locator('[data-testid="request-pane"] >> text=Unary').click();
    await page.click('text=Send');

    // Check for the single Unary response
    await page.click('text=Response 1');
    await expect(statusTag).toContainText('0 OK');
    await expect(responseBody).toContainText('Berkshire Valley Management Area Trail');
  });

  test('can send bidirectional requests @ci', async ({ page }) => {
    await page.getByLabel('Request Collection').getByRole('row', { name: 'Bidirectional Stream' }).click();
    await page.locator('text=Bi-directional Streaming').click();
    await page.click('text=Start');

    // Stream 3 client messages
    await streamMessage.click();
    await streamMessage.click();
    await streamMessage.click();

    // Check for the 3rd stream, and a reply to each, listed as they arrive
    await page.locator('text=Stream 3').click();
    await expect(page.getByText('Received at:')).toHaveCount(3);

    // Finish the stream
    await page.locator('text=Commit').click();
    await expect(statusTag).toContainText('0 OK');
  });

  test('can send client stream requests @ci', async ({ page }) => {
    await page.getByLabel('Request Collection').getByRole('row', { name: 'Client Stream' }).click();
    await page.click('text=Client Streaming');
    await page.click('text=Start');

    // Stream 3 client messages
    await streamMessage.click();
    await streamMessage.click();
    await streamMessage.click();

    // Finish the stream and check response
    await page.locator('text=Commit').click();
    await page.locator('text=Stream 3').click();
    await page.locator('text=Response 1').click();
    await expect(statusTag).toContainText('0 OK');
    await expect(responseBody).toContainText('point_count": 3');
  });

  test('can send server stream requests @ci', async ({ page }) => {
    await page.getByLabel('Request Collection').getByRole('row', { name: 'Server Stream' }).click();
    await page.click('text=Server Streaming');
    await page.click('text=Start');

    // Check response
    await expect(statusTag).toContainText('0 OK');
    // its replies are listed as they arrive, the last at the bottom
    await expect(page.getByText('Received at:')).toHaveCount(64);
    await expect(page.getByTestId('response-pane')).toContainText('3 Hasta Way');
  });

});
