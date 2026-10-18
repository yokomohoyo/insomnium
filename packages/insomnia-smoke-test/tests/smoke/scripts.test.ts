import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// a request whose scripts set its id and check what comes back
const collection = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Scripts, scope: collection }
  - _id: req_1
    _type: request
    parentId: wrk_1
    name: scripted pet
    method: GET
    url: 'http://127.0.0.1:4010/pets/{{ id }}'
    preRequestScript: |
      insomnia.variables.set('id', '7');
      console.log('sending for', insomnia.variables.get('id'));
    afterResponseScript: |
      insomnia.test('echoes the id', () => insomnia.expect(insomnia.response.json().id).to.equal('7'));
      pm.test('is 404', () => pm.response.to.have.status(404));
`;

test('scripts run in the sandbox around a send, and their tests join the Tests tab @ci', async ({ app, page }) => {
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'scripted pet' }).click();

  await requestPane.getByRole('tab', { name: /Scripts/ }).click();
  await expect(requestPane.getByRole('tab', { name: /Scripts/ })).toContainText('2');
  await expect(requestPane.getByRole('region', { name: 'Pre-request script' })).toContainText("insomnia.variables.set('id', '7');");

  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane).toContainText('200 OK');
  await responsePane.getByRole('tab', { name: /Tests/ }).click();
  await expect(responsePane.getByTestId('assertion-summary')).toHaveText('1 of 2 passed');
  await expect(responsePane.getByRole('list', { name: 'Assertion results' })).toContainText('is 404: expected response to have status code 404 but got 200');
  await expect(responsePane.getByTestId('script-console')).toHaveText('sending for 7');
  await page.screenshot({ path: 'traces/scripts.png' });
});
