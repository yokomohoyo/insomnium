import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// a folder with a request that has no auth of its own
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Folder auth, scope: collection }
  - { _id: fld_1, _type: request_group, parentId: wrk_1, name: Protected }
  - { _id: req_1, _type: request, parentId: fld_1, name: basic in folder, method: GET, url: 'http://127.0.0.1:4010/auth/basic', authentication: [] }
`;

test("a request with no auth uses its folder's @ci", async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  const requests = page.getByLabel('Request Collection');
  await requests.getByRole('row', { name: 'basic in folder' }).click();

  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('401');

  // give the folder Basic auth
  const folder = requests.getByRole('row', { name: 'Protected' });
  await folder.getByLabel('Request Group Actions').click();
  await page.getByRole('menuitemradio', { name: 'Settings' }).click();
  const folderAuth = page.getByRole('dialog').getByRole('region', { name: 'Folder auth' });
  await folderAuth.getByRole('button', { name: /Add Auth/ }).click();
  await page.getByRole('menuitem', { name: 'Basic Auth' }).click();
  await folderAuth.getByTestId('OneLineEditor').nth(0).locator('.CodeMirror textarea').fill('user');
  await folderAuth.getByTestId('OneLineEditor').nth(1).locator('.CodeMirror textarea').fill('pass');
  await page.screenshot({ path: 'traces/folder-auth-settings.png' });
  // the editors save 100 ms after the last change
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');

  // both were kept: they're there when the settings open again
  await folder.getByLabel('Request Group Actions').click();
  await page.getByRole('menuitemradio', { name: 'Settings' }).click();
  await expect(folderAuth.getByTestId('OneLineEditor').nth(0)).toContainText('user');
  await folderAuth.getByTestId('reveal-password-icon').click();
  await expect(folderAuth.getByTestId('OneLineEditor').nth(1)).toContainText('pass');
  await page.keyboard.press('Escape');

  // the Auth tab is the Add Auth dropdown: it opens, then closes
  await requestPane.getByRole('tab', { name: /Auth/ }).click();
  await page.keyboard.press('Escape');
  await expect(requestPane).toContainText('Uses the auth of the folder Protected');
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('basic auth received');
});
