import { expect } from '@playwright/test';

import { importIntoProject } from '../../playwright/import';
import { loadFixture } from '../../playwright/paths';
import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

test.describe('Cookie editor', async () => {

  test.beforeEach(async ({ app, page }) => {
    await importIntoProject(app, page, await loadFixture('simple.yaml'), 'simple');
  });

  test('create and send a cookie @ci', async ({ page }) => {

    // Open cookie editor
    await page.click('button:has-text("Cookies")');

    // Edit existing cookie
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.click('pre[role="presentation"]:has-text("bar")');
    await page.locator('[data-testid="CookieValue"] >> textarea').nth(1).fill('123');
    await page.locator('text=Done').nth(1).click();
    await page.getByRole('cell', { name: 'foo=b123ar; Expires=' }).click();

    // Create a new cookie
    await page.locator('.cookie-list').getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Add Cookie' }).click();
    await page.getByRole('button', { name: 'Edit' }).first().click();

    // Try to replace text in Raw view
    await page.getByRole('tab', { name: 'Raw' }).click();
    await page.locator('text=Raw Cookie String >> input[type="text"]').fill('foo2=bar2; Expires=Tue, 19 Jan 2038 03:14:07 GMT; Domain=localhost; Path=/');
    await page.locator('text=Done').nth(1).click();
    await page.getByRole('cell', { name: 'foo2=bar2; Expires=' }).click();

    await page.click('text=Done');

    // Send http request
    await openRequest(page, 'example http');
    await page.click('[data-testid="request-pane"] button:has-text("Send")');

    // Check in the timeline that the cookie was sent
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await page.click('text=foo2=bar2; foo=b123ar');

    // Send ws request
    await openRequest(page, 'example websocket');
    await expect(page.getByTestId('request-pane')).toContainText('ws://localhost:4010');
    await page.click('[data-testid="request-pane"] >> text=Connect');

    // Check in the timeline that the cookie was sent
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await page.click('text=foo2=bar2; foo=b123ar;');
  });

});
