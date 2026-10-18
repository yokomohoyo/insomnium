import http from 'node:http';

import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

const PORT = 18_899;

// a request sent through the capture proxy, as an app with HTTP_PROXY set sends it
const throughProxy = (url: string) => new Promise<number>((resolve, reject) => {
  const request = http.request({ host: '127.0.0.1', port: PORT, path: url, method: 'GET', headers: { Accept: 'application/json' } }, response => {
    response.resume();
    response.on('end', () => resolve(response.statusCode || 0));
  });
  request.on('error', reject);
  request.end();
});

test('Capture Traffic records what is sent through it, to keep as requests @ci', async ({ page }) => {
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Capture Traffic' }).click();
  const capture = page.getByRole('dialog');
  await capture.getByLabel('Capture port').fill(String(PORT));
  await capture.getByRole('button', { name: 'Start Capturing' }).click();
  await expect(capture.getByTestId('capture-status')).toContainText(`127.0.0.1:${PORT}`);

  expect(await throughProxy('http://127.0.0.1:4010/pets/7')).toBe(200);
  const row = capture.getByRole('row', { name: 'GET http://127.0.0.1:4010/pets/7' });
  await expect(row).toContainText('200');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(capture).toContainText('Saved 1 request to My Collection.');

  await capture.getByRole('button', { name: 'Stop' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Request Collection').getByRole('row', { name: 'GET /pets/7' })).toBeVisible();
});
