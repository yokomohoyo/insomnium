import type { ElectronApplication, Page } from '@playwright/test';

// Imports an export (Insomnia, Postman, curl…) into the open collection,
// through the clipboard: the app opens in My Collection.
export async function importIntoCollection(app: ElectronApplication, page: Page, text: string) {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
}
