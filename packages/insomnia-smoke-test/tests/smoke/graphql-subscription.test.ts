import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Subscriptions, scope: collection }
  - { _id: env_1, _type: environment, parentId: wrk_1, name: Base Environment, data: { species: cat } }
  - _id: ws-req_1
    _type: websocket_request
    parentId: wrk_1
    name: pets added
    url: 'ws://127.0.0.1:4010/graphql'
    graphqlSubscription:
      enabled: true
      query: 'subscription PetAdded($species: String) { petAdded(species: $species) { name species } }'
      variables: '{ "species": "{{ species }}" }'
`;

test('a WebSocket request subscribes with GraphQL, and shows each event @ci', async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'pets added' }).click();

  await page.getByRole('tab', { name: 'GraphQL' }).click();
  await expect(page.getByLabel('Subscribe when connected')).toBeChecked();
  await expect(page.getByTestId('request-pane')).toContainText('subscription PetAdded');

  await page.getByRole('button', { name: 'Connect' }).click();
  // the server's events, for the variables rendered from the environment
  const events = page.getByTestId('response-pane').filter({ hasText: 'Fido' });
  await expect(events).toHaveCount(1);
  await expect(events).toContainText('cat');
  await expect(events).toContainText('connection_ack');
  // the subscription completed, so the connection closed
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
});
