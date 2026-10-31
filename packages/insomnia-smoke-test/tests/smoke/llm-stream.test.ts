import { expect } from '@playwright/test';

import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

const collection = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'Models', scope: 'collection' },
    {
      _id: 'req_1',
      _type: 'request',
      parentId: 'wrk_1',
      name: 'ask the fake model',
      method: 'POST',
      url: 'http://127.0.0.1:4010/v1/chat/completions',
      headers: [
        { name: 'Accept', value: 'text/event-stream' },
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer e2e-key' },
      ],
      body: { mimeType: 'application/json', text: JSON.stringify({ model: 'fake-model', stream: true, messages: [{ role: 'user', content: 'Say hello' }] }) },
    },
  ],
});

test("a model's streamed reply is put together, with its tokens and timing @ci", async ({ app, page }) => {
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), collection);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await openRequest(page, 'ask the fake model');

  await page.getByTestId('request-pane').getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('tab', { name: 'LLM' }).click();
  const reply = page.getByTestId('llm-stream');
  await expect(reply.getByTestId('llm-text')).toHaveText('Hello from the fake model.');
  await expect(reply.getByTestId('llm-usage')).toHaveText('12 in · 5 out · 17 total');
  await expect(reply).toContainText('fake-model');
  await expect(reply).toContainText('stop');
  // timed from the request: the fake model's first word comes 50 ms after it
  await expect(reply.getByTestId('llm-first-token')).toHaveText(/^\d+ ms$/);
  await expect(reply.getByTestId('llm-first-token')).not.toHaveText('0 ms');

  // a new one starts from a chat completion to stream
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'LLM Request' }).click();
  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'New LLM Request' })).toBeVisible();
  await expect(page.getByTestId('request-pane').getByRole('button', { name: 'Connect' })).toBeVisible();
});
