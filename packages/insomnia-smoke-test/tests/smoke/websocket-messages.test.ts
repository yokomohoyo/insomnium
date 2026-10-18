import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Sockets, scope: collection }
  - { _id: ws-req_1, _type: websocket_request, parentId: wrk_1, name: echo socket, url: 'ws://127.0.0.1:4010' }
`;

test('a WebSocket message is saved with the request and put back in the editor @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'echo socket' }).click();

  const editor = page.locator('#websocketMessageForm .CodeMirror');
  await editor.click();
  await page.keyboard.insertText('{"type": "hello"}');
  await page.getByRole('button', { name: 'Save Message' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Greeting');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Saved messages')).toContainText('Greeting');

  // a different draft, then the saved message back
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('{"type": "other"}');
  await page.getByLabel('Saved messages').selectOption({ label: 'Greeting' });
  await expect(editor).toContainText('{"type": "hello"}');
  await page.screenshot({ path: 'traces/websocket-messages.png' });
});
