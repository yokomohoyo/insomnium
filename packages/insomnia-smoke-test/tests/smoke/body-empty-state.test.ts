import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test("a request's empty Body tab is about its body, not a response @ci", async ({ page }) => {
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'HTTP Request' }).click();
  const requestPane = page.getByTestId('request-pane');
  await requestPane.getByRole('tab', { name: /^Body/ }).click();
  await expect(requestPane).toContainText('This request has no body');
  await expect(requestPane).toContainText('Choose a body type from the Body menu above');
  await expect(requestPane).not.toContainText('send to get a response');
});

test("an event stream's empty Body tab is about its body, not connecting @ci", async ({ page }) => {
  await page.getByLabel('Create in collection').click();
  await page.getByRole('menuitemradio', { name: 'Event Stream Request' }).click();
  const requestPane = page.getByTestId('request-pane');
  await requestPane.getByRole('tab', { name: /^Body/ }).click();
  await expect(requestPane).toContainText('This request has no body');
  await expect(requestPane).not.toContainText('Enter a URL and connect');
});
