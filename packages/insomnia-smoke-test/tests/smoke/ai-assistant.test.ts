import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Pets, scope: collection }
  - { _id: env_1, _type: environment, parentId: wrk_1, name: Base Environment, data: { base_url: 'http://127.0.0.1:4010' } }
  - { _id: req_1, _type: request, parentId: wrk_1, name: pet one, method: GET, url: '{{ base_url }}/pets/1' }
`;

test('the AI assistant writes a request from a description, with a model of your choosing @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'pet one' })).toBeVisible();

  // off until it's set up
  await page.getByLabel('Create in collection').click();
  await expect(page.getByRole('menuitemradio', { name: 'From Curl' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'From a Description…' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.locator('input[name="aiBaseUrl"]').fill('http://127.0.0.1:4010/v1');
  await page.getByRole('button', { name: 'List Models' }).click();
  await expect(page.getByTestId('ai-status')).toContainText('Incorrect API key provided');
  await page.locator('input[name="aiApiKey"]').fill('e2e-key');
  await page.getByRole('button', { name: 'List Models' }).click();
  await expect(page.getByTestId('ai-status')).toContainText('The endpoint offers 2 models');
  await page.getByLabel('Offered models').selectOption('fake-model');
  await expect(page.locator('input[name="aiModel"]')).toHaveValue('fake-model');
  await page.getByRole('button', { name: 'Try the Model' }).click();
  await expect(page.getByTestId('ai-status')).toContainText('fake-model replied: ready');
  await page.keyboard.press('Escape');

  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'From a Description…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Sent to 127.0.0.1:4010 (fake-model)');
  await dialog.getByLabel('Describe the request').fill('Get pet two from the pets API');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'Pet two' })).toBeVisible();
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-testid="response-status-tag"]:visible')).toContainText('200');
  await expect(page.getByTestId('response-pane')).toContainText('"id": "2"');
});
