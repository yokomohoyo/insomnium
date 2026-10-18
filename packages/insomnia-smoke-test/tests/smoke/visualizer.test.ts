import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// a Postman-style visualization: a Handlebars template, a script in it that
// gets the data, and one that tries the network, which the visualizer blocks
const script = [
  "const template = '<h1 id=\"pet\">Pet {{id}}</h1>'",
  "  + '<script>pm.getData(function (err, data) { document.title = \"got \" + data.id; });'",
  "  + 'fetch(\"http://127.0.0.1:4010/pets/9\").then(function () { document.body.dataset.network = \"open\"; }, function () { document.body.dataset.network = \"blocked\"; });<\\/script>';",
  'pm.visualizer.set(template, pm.response.json());',
].join('\n');

const collection = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Visualizer', scope: 'collection' },
    { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'pet one', method: 'GET', url: 'http://127.0.0.1:4010/pets/1', afterResponseScript: script },
  ],
});

test("the Visualize tab renders what the script set, and keeps it off the network @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'pet one' }).click();

  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-testid="response-status-tag"]:visible')).toContainText('200');
  await page.getByRole('tab', { name: 'Visualize' }).click();
  await expect(page.getByTestId('ResponseVisualizer')).toBeVisible();

  // the webview's page, read from the main process
  const visualized = () => app.evaluate(async ({ webContents }) => {
    const guest = webContents.getAllWebContents().find(contents => contents.getType() === 'webview' && contents.getURL().startsWith('data:'));
    return guest ? guest.executeJavaScript('({ heading: document.querySelector("#pet")?.textContent, title: document.title, network: document.body.dataset.network })') : null;
  });
  await expect.poll(visualized, { timeout: 15_000 }).toEqual({ heading: 'Pet 1', title: 'got 1', network: 'blocked' });
});
