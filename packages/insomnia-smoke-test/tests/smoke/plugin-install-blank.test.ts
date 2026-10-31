import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('Install Plugin waits for a package name @ci', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.locator('div[role="tab"]:has-text("Plugins")').click();

  const install = page.getByRole('button', { name: 'Install Plugin' });
  const name = page.getByPlaceholder('npm-package-name');
  await expect(install).toBeDisabled();
  await name.fill('   ');
  await expect(install).toBeDisabled();
  // Enter in the field doesn't install either
  await name.press('Enter');
  await expect(page.getByText('Failed to install')).toHaveCount(0);

  await name.fill('insomnia-plugin-example');
  await expect(install).toBeEnabled();
});
