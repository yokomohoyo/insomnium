import { expect } from '@playwright/test';

import { importIntoCollection } from '../../playwright/import';
import { loadFixture } from '../../playwright/paths';
import { openRequest } from '../../playwright/requests';
import { test } from '../../playwright/test';

test.describe('Environment Editor', async () => {

  test.beforeEach(async ({ app, page }) => {
    await importIntoCollection(app, page, await loadFixture('environments.yaml'));
  });

  test('create a new environment @ci', async ({ page }) => {
    // Create the environment (which will become active on creation)
    // await page.getByLabel("Select an environment").click();
    await page.getByLabel('Manage Environments').click();
    await page.getByTestId('CreateEnvironmentDropdown').click();
    await page.getByRole('menuitem', { name: 'Environment', exact: true }).click();
    await page.getByRole('option', { name: 'New Environment' }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    // Send a request check variables defaulted to base env since new env is empty
    await openRequest(page, 'show environment variables');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await page.getByText('baseenv0').click();
    await page.getByText('baseenv1').click();
  });

  // rename an existing environment
  test('Rename an existing environment @ci', async ({ page }) => {
    // Rename the environment (which will make it active)
    await page.getByLabel('Manage Environments').click();
    await page.getByRole('option', { name: 'ExampleB' }).click();
    await page.getByTitle('Click to edit', { exact: true }).click();
    await page.getByRole('dialog').locator('input[type="text"]').fill('Gandalf');
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    // Send a request check variables defaulted to base env since new env is empty
    await openRequest(page, 'show environment variables');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await page.getByText('subenvB0').click();
    await page.getByText('subenvB1').click();
  });

  test('Add new variables to an existing environment @ci', async ({ page }) => {
    await page.getByLabel('Manage Environments').click();
    await page.getByRole('option', { name: 'ExampleA' }).click();
    // add a new string environment variable
    await page.locator('pre').filter({ hasText: '"exampleNumber": 1111,' }).click();
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Enter');
    await page.getByTestId('CodeEditor').getByRole('textbox').fill('"testNumber":9000,');
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Enter');
    await page.getByTestId('CodeEditor').getByRole('textbox').fill('"testString":"Gandalf",');
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Enter');

    // Open request
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Request Collection').getByRole('row', { name: 'show environment variables' }).click();

    // Add number variable to request body
    await page.locator('pre').filter({ hasText: '_.exampleObject.anotherNumber' }).click();
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Enter');
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Control+ ');
    await page.getByText('_.testNumber').click();

    // Add string variable to request body
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Enter');
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Control+ ');
    await page.getByText('_.testString').click();
    await page.getByTestId('CodeEditor').getByRole('textbox').press('Enter');

    // TODO(filipe) add an environment variable that returns value of a nunjucks template (e.g. timestamp)

    // Check new variables are in the timeline. The body is saved 100ms after
    // the last keystroke, so a send straight after may still carry the old one.
    const timeline = page.getByTestId('response-pane').getByTestId('CodeEditor');
    await expect(async () => {
      await page.getByRole('button', { name: 'Send' }).click();
      await page.getByRole('tab', { name: 'Timeline' }).click();
      await expect(timeline).toContainText('| 9000', { timeout: 2000 });
    }).toPass();
    await expect(timeline).toContainText('| Gandalf');
  });
});
