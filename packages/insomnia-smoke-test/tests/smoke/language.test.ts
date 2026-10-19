import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('the app speaks the language chosen in Preferences @ci', async ({ page }) => {
  const preferences = page.getByTestId('settings-button');
  await expect(preferences).toContainText('Preferences');

  await preferences.click();
  await page.locator('select[name="language"]').selectOption('de');

  // the window loads again, in German
  await expect(preferences).toContainText('Einstellungen', { timeout: 30_000 });
  await preferences.click();
  await expect(page.getByRole('dialog')).toContainText('Sprache');
  await expect(page.locator('select[name="language"]')).toHaveValue('de');
});
