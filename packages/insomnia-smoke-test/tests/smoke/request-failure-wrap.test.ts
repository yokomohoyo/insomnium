import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

// a pre-request script that doesn't parse, whose error is long
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Scripts, scope: collection }
  - { _id: req_1, _type: request, parentId: wrk_1, name: broken script, method: GET, url: 'http://127.0.0.1:4010/pets/1', preRequestScript: "insomnia.environment.set('a long variable name to make the message long', " }
`;

test("a request's failure message wraps in its alert, rather than scrolling out of sight @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'broken script');

  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  const message = page.getByRole('dialog').locator('pre');
  await expect(message).toContainText('The pre-request script failed');
  const { scrollWidth, clientWidth } = await message.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
