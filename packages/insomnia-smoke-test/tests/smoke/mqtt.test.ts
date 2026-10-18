import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Brokers, scope: collection }
  - _id: ws-req_1
    _type: websocket_request
    parentId: wrk_1
    name: smoke broker
    url: 'ws://127.0.0.1:4010/mqtt'
`;

test('a WebSocket request speaks MQTT: connect, subscribe, deliveries and publishing @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'smoke broker' }).click();

  const mqttTab = page.getByRole('tab', { name: 'MQTT' });
  await mqttTab.click();
  await page.getByLabel('MQTT client ID').fill('e2e-client');
  await page.getByLabel('MQTT user name').fill('smoke');
  await page.getByLabel('MQTT password').fill('secret');
  await page.getByLabel('MQTT subscriptions').fill('smoke/# 1');
  // turned on last: each edit saves the whole, and a quicker one replaces a
  // save still going, so the tab's check means all of it is saved
  await page.getByLabel('Use MQTT').check();
  await expect(mqttTab.locator('.bubble')).toBeVisible();

  await page.getByRole('button', { name: 'Connect' }).click();
  // the WebSocket's pane: there's a second, hidden response pane
  const events = page.getByTestId('response-pane').filter({ hasText: 'CONNACK' });
  await expect(events).toContainText('CONNACK: connected');
  await expect(events).toContainText('SUBACK: QoS 1');
  await expect(events).toContainText('smoke/hello: retained hi');
  // the delivery at QoS 1 was acknowledged
  await expect(events).toContainText('smoke/acked: puback 7');

  // back to the message, the first tab (its title is the preview mode's menu)
  await page.getByRole('tab', { name: 'MQTT' }).focus();
  await page.keyboard.press('Home');
  await page.getByLabel('MQTT topic').fill('smoke/echo');
  await page.locator('#websocketMessageForm .CodeMirror').click();
  await page.keyboard.insertText('hi broker');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(events).toContainText('smoke/echo: hi broker');
  await expect(events).toContainText('smoke/echo: echo hi broker');
});
