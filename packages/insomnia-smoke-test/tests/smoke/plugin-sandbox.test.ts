import fs from 'fs';
import path from 'path';

import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// two plugins: one whose tag says what it can reach, and one that needs Node.js
const plugins = {
  'insomnia-plugin-e2e-sandbox': `
    module.exports.templateTags = [{
      name: 'sandboxGreeting',
      displayName: 'Sandbox greeting',
      args: [{ displayName: 'Name', type: 'string' }],
      async run(context, name) {
        await context.store.setItem('last', name);
        return ['hi', await context.store.getItem('last'), typeof process, typeof fetch, Buffer.from('ok').toString('base64')].join('-');
      },
    }];
  `,
  'insomnia-plugin-e2e-node': `
    const fs = require('fs');
    module.exports.templateTags = [{ name: 'nodeFiles', displayName: 'Node files', run: () => String(typeof fs.readFileSync) }];
  `,
};

const collection = JSON.stringify({
  info: { name: 'Sandboxed plugins', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'pet from a plugin', request: { method: 'GET', url: "http://127.0.0.1:4010/pets/{% sandboxGreeting 'kim' %}" } }],
});

test('a plugin runs in its sandbox, without Node.js or the network, unless it has full access @ci', async ({ app, page }) => {
  const dataPath = await app.evaluate(() => process.env.INSOMNIA_DATA_PATH || '');
  for (const [name, main] of Object.entries(plugins)) {
    const dir = path.join(dataPath, 'plugins', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'main.js', insomnia: { name } }));
    fs.writeFileSync(path.join(dir, 'main.js'), main);
  }

  // Preferences → Plugins loads them again
  await page.getByTestId('settings-button').click();
  await page.locator('div[role="tab"]:has-text("Plugins")').click();
  const sandboxed = page.getByRole('row').filter({ hasText: 'insomnia-plugin-e2e-sandbox' });
  const needsNode = page.getByRole('row').filter({ hasText: 'insomnia-plugin-e2e-node' });
  await expect(sandboxed).toContainText('Sandboxed');
  await expect(sandboxed.getByTestId('plugin-load-error')).toHaveCount(0);
  await expect(needsNode.getByTestId('plugin-load-error')).toContainText('It needs Node.js (its fs module)');
  await page.keyboard.press('Escape');

  // its tag renders in a request, from the sandbox
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Request Collection').getByRole('row', { name: 'pet from a plugin' }).click();
  await page.getByTestId('request-pane').getByRole('button', { name: 'Send' }).click();
  // no process, no fetch; the store and Buffer work
  await expect(page.getByTestId('response-pane')).toContainText(`hi-kim-undefined-undefined-${Buffer.from('ok').toString('base64')}`);

  // the one that needs Node.js loads once it's allowed full access
  await page.getByTestId('settings-button').click();
  await page.locator('div[role="tab"]:has-text("Plugins")').click();
  await needsNode.getByRole('checkbox', { name: 'Sandboxed' }).check();
  await page.getByRole('dialog').filter({ hasText: 'full access' }).getByRole('button', { name: 'Allow Full Access' }).click();
  await expect(needsNode).toContainText('Full access');
  await expect(needsNode.getByTestId('plugin-load-error')).toHaveCount(0);
});
