import { expect } from '@playwright/test';

import { importIntoCollection } from '../../playwright/import';
import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test('can render schema and send GraphQL requests @ci', async ({ app, page }) => {
  test.slow(process.platform === 'darwin' || process.platform === 'win32', 'Slow app start on these platforms');

  await importIntoCollection(app, page, await loadFixture('graphql.yaml'));
  // Open the graphql request
  await page.getByLabel('Request Collection').getByRole('row', { name: 'GraphQL request' }).click();
  // introspection waits for the request to be sent once, or a refresh
  await expect(page.locator('.graphql-editor__meta')).toContainText('schema not yet fetched');
  await page.getByRole('button', { name: 'schema' }).click();
  await page.getByRole('menuitem', { name: 'Refresh Schema' }).click();
  await expect(page.locator('.graphql-editor__meta')).toContainText('schema fetched just now');

  // Assert schema documentation stuff
  await page.getByRole('button', { name: 'schema' }).click();
  await page.getByRole('menuitem', { name: 'Show Documentation' }).click();
  await page.click('a:has-text("Query")');
  await page.locator('a:has-text("RingBearer")').click();
  const graphqlExplorer = page.locator('.graphql-explorer');
  await expect(graphqlExplorer).toContainText('Characters who at any time bore a Ring of Power.');
  await page.click('text=QueryRingBearer >> button');

  // Send and assert GraphQL request
  await page.click('[data-testid="request-pane"] >> text=Send');
  const statusTag = page.locator('[data-testid="response-status-tag"]:visible');
  await expect(statusTag).toContainText('200 OK');

  const responseBody = page.locator('[data-testid="response-pane"] >> [data-testid="CodeEditor"]:visible', {
    has: page.locator('.CodeMirror-activeline'),
  });
  await expect(responseBody).toContainText('"bearer": "Gandalf"');
});

test('can send GraphQL requests after editing and prettifying query @ci', async ({ app, page }) => {
  test.slow(process.platform === 'darwin' || process.platform === 'win32', 'Slow app start on these platforms');

  await importIntoCollection(app, page, await loadFixture('graphql.yaml'));
  await page.getByLabel('Request Collection').getByRole('row', { name: 'GraphQL request' }).click();

  // Edit and prettify query
  await page.locator('pre[role="presentation"]:has-text("bearer")').click();
  await page.locator('.app').press('Enter');
  await page.locator('text=Prettify GraphQL').click();
  await page.click('[data-testid="request-pane"] >> text=Send');
  const statusTag = page.locator('[data-testid="response-status-tag"]:visible');
  await expect(statusTag).toContainText('200 OK');

  const responseBody = page.locator('[data-testid="response-pane"] >> [data-testid="CodeEditor"]:visible', {
    has: page.locator('.CodeMirror-activeline'),
  });
  await expect(responseBody).toContainText('"bearer": "Gandalf"');
});
