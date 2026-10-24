import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// a socket to send a hex message on, and one the server cuts off each time, with reconnecting on
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Sockets, scope: collection }
  - { _id: ws-req_1, _type: websocket_request, parentId: wrk_1, name: binary echo, url: 'ws://127.0.0.1:4010' }
  - _id: ws-req_2
    _type: websocket_request
    parentId: wrk_1
    name: dropping socket
    url: 'ws://127.0.0.1:4010/drop'
    reconnect: { enabled: true, delaySeconds: 1, maxAttempts: 2 }
`;

test('a WebSocket sends a hex message as a binary frame, and reconnects when dropped @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  // the message goes out as 5 bytes, and the echo server sends them back
  await page.getByLabel('Request Collection').getByRole('row', { name: 'binary echo' }).click();
  // the message's mode is the first tab's title, a menu: a tab's content
  // isn't in the accessibility tree, so found by its text
  const modeMenu = page.getByRole('tablist', { name: 'Websocket request pane tabs' }).locator('[data-key="websocket-preview-mode"] button');
  await modeMenu.filter({ hasText: 'JSON' }).click();
  await page.getByRole('menuitem', { name: 'Hex (binary)' }).click();
  await expect(modeMenu).toHaveText('Hex');
  await page.locator('#websocketMessageForm .CodeMirror').click();
  await page.keyboard.insertText('48 65 6c 6c 6f');
  // connected first, by the URL's button, which shows the new response
  await page.getByRole('button', { name: 'Connect' }).click();
  // the WebSocket's pane: there's a second, hidden response pane
  const events = page.getByTestId('response-pane').filter({ hasText: 'Connected successfully' });
  await expect(events).toBeVisible();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(events.getByText('Binary, 5 bytes: 48 65 6c 6c 6f')).toHaveCount(2);
  await events.getByText('Binary, 5 bytes: 48 65 6c 6c 6f').first().click();
  await expect(events).toContainText('|Hello|');
  await page.getByRole('button', { name: 'Disconnect' }).click();

  // dropped after half a second: it comes back twice, then gives up
  await page.getByLabel('Request Collection').getByRole('row', { name: 'dropping socket' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  const dropping = page.getByTestId('response-pane').filter({ hasText: 'Connected successfully' });
  await expect(dropping.getByText('Connected successfully')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByTestId('response-pane').filter({ hasText: 'Gave up reconnecting' })).toContainText('Gave up reconnecting after 2 attempts');
  await page.screenshot({ path: 'traces/websocket-binary.png' });
});
