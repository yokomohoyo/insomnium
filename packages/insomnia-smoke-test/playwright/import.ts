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

// Imports an export as a collection of its own, with its environments and
// cookie jar, from the project's dashboard; then opens it.
export async function importIntoProject(app: ElectronApplication, page: Page, text: string, name: string) {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create in project' }).click();
  await page.getByRole('menuitemradio', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Workspaces').getByRole('row', { name }).click();
}
