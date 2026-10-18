import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('Preferences list the data snapshots, and take one by hand @ci', async ({ page }) => {
  // the status bar's button, there once the app has loaded
  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  const snapshots = page.getByRole('region', { name: 'Snapshots' });
  // the one taken at launch, since this data has none a day old
  await expect(snapshots.getByRole('list', { name: 'Snapshots taken' }).getByRole('listitem')).toHaveCount(1);
  await snapshots.getByRole('button', { name: 'Take One Now' }).click();
  await expect(snapshots.getByRole('list', { name: 'Snapshots taken' }).getByRole('listitem')).toHaveCount(2);
  await expect(snapshots).toContainText('taken by hand');
  await page.screenshot({ path: 'traces/snapshots.png' });
});
