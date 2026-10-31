import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test("an empty spec has no lint warning, and one that's started does @ci", async ({ page }) => {
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Design Document' }).click();
  await expect(page.getByText('start from an example')).toBeVisible();

  const editor = page.locator('.CodeMirror').first();
  // a marker, not the gutter that holds them (CodeMirror-lint-markers)
  const markers = editor.locator('.CodeMirror-lint-marker');
  // the editor lints a second after a change
  await page.waitForTimeout(2500);
  await expect(markers).toHaveCount(0);

  // a spec without contact, servers or a description: Spectral warns
  await editor.evaluate((element, text) => (element as unknown as { CodeMirror: { setValue: (value: string) => void } }).CodeMirror.setValue(text),
    '{"openapi": "3.0.0", "info": {"title": "Pets", "version": "1.0.0"}, "paths": {}}');
  await expect(markers.first()).toBeVisible({ timeout: 15_000 });
});
