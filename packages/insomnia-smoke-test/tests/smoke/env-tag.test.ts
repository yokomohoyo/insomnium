import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

// set before the fixture launches the app, which passes its environment on
process.env.INSOMNIUM_E2E_PET = 'from-the-os';

const collection = JSON.stringify({
  info: { name: 'OS environment', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet from env', request: { method: 'GET', url: "http://127.0.0.1:4010/pets/{% env 'INSOMNIUM_E2E_PET' %}" } }],
});

test('the env tag reads only the variables Preferences allow @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pet from env');

  // none are allowed to begin with
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('dialog')).toContainText("INSOMNIUM_E2E_PET isn't an allowed environment variable");
  await page.keyboard.press('Escape');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByLabel('Allowed names').fill('INSOMNIUM_E2E_*');
  await page.screenshot({ path: 'traces/env-tag-preferences.png' });
  await page.keyboard.press('Escape');

  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('from-the-os');
});
