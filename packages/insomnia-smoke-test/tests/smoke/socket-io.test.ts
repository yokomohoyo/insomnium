import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Sockets, scope: collection }
  - _id: ws-req_1
    _type: websocket_request
    parentId: wrk_1
    name: pets socket
    url: 'http://127.0.0.1:4010'
    socketIo: { enabled: true, namespace: /pets, auth: '{ "token": "abc" }', event: hello }
`;

test('a WebSocket request speaks Socket.IO: a namespace, auth, and events @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'pets socket');

  await page.getByRole('button', { name: 'Connect' }).click();
  // the namespace's connect, with the auth, and the server's welcome
  const events = page.getByTestId('response-pane').filter({ hasText: 'welcome' });
  await expect(events).toHaveCount(1);
  await expect(events).toContainText('40/pets,{"token":"abc"}');
  await expect(events).toContainText('"token":"abc"');

  // a message is the event's arguments
  await expect(page.getByLabel('Socket.IO event')).toHaveValue('hello');
  await page.locator('#websocketMessageForm .CodeMirror').click();
  await page.keyboard.insertText('{"name": "Rex"}');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(events).toContainText('42/pets,["hello",{"name":"Rex"}]');
  await expect(events).toContainText('hello back');
});
