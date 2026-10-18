import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: MCP, scope: collection }
  - { _id: mcp-req_1, _type: mcp_request, parentId: wrk_1, name: smoke mcp, transport: http, url: 'http://127.0.0.1:4010/mcp', headers: [], command: '', args: '' }
`;

test("an MCP request connects to a server, lists its tools, and calls one @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'smoke mcp' }).click();

  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByTestId('mcp-server')).toContainText('smoke-pets');
  await expect(page.getByRole('tab', { name: 'Tools (1)' })).toBeVisible();
  await expect(page.getByLabel('MCP tool')).toHaveValue('add');

  // its arguments, from the tool's schema to start with
  const responsePane = page.getByTestId('response-pane').filter({ has: page.getByTestId('mcp-server') });
  const argumentsEditor = responsePane.locator('.CodeMirror').first();
  await expect(argumentsEditor).toContainText('"a": 0');
  await argumentsEditor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('{ "a": 2, "b": 3 }');
  await responsePane.getByRole('button', { name: 'Call' }).click();
  await expect(page.getByTestId('mcp-result')).toContainText('sum: 5');

  await page.getByRole('tab', { name: 'Resources (1)' }).click();
  await responsePane.getByRole('button', { name: 'Read' }).click();
  await expect(page.getByTestId('mcp-result')).toContainText('Smoke pets');

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
});
