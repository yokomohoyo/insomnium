import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test("a flow step's long message wraps in Last Run, without scrolling the panel sideways @ci", async ({ page }) => {
  await page.getByRole('link', { name: 'flows', exact: true }).click();
  await page.getByRole('button', { name: 'New Flow' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create Flow' }).click();

  // a variable name with a hyphen fails, with a long message
  await page.getByRole('toolbar', { name: 'Flow' }).getByRole('button', { name: 'Set Variable' }).click();
  const step = page.getByRole('region', { name: 'Step' });
  await step.getByLabel('Name', { exact: true }).fill('user-id');
  await page.getByRole('button', { name: 'Run Flow' }).click();

  const run = page.getByRole('region', { name: 'Run' });
  await expect(run.getByRole('listitem')).toHaveCount(2);
  const panel = run.locator('..');
  const { scrollWidth, clientWidth } = await panel.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
