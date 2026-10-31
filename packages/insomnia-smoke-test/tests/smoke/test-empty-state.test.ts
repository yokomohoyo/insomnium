import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('the Test tab says what it is for, like the Flows tab @ci', async ({ page }) => {
  await page.getByRole('link', { name: 'test', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Tests', exact: true })).toBeVisible();
  await expect(page.getByText("A test suite holds JavaScript tests that send the collection's requests")).toBeVisible();
  await expect(page.getByText('Run a test suite to see its results here')).toBeVisible();
  await expect(page.getByText('No test suite selected')).toHaveCount(0);

  // its button starts a suite, as the sidebar's does
  await page.getByRole('button', { name: 'New Test Suite' }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create Suite' }).click();
  await expect(page.getByRole('button', { name: 'New Suite' })).toBeVisible();
});
