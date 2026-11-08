import { expect } from '@playwright/test';

import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test.describe('Dashboard', async () => {
  test.slow(process.platform === 'darwin' || process.platform === 'win32', 'Slow app start on these platforms');
  test.describe('Projects', async () => {
    test('Can create, rename and delete new project @ci', async ({ page }) => {
      await page.getByTestId('project').click();
      await expect(page.locator('.app')).not.toContainText('Git Sync');
      await expect(page.locator('.app')).not.toContainText('Setup Git Sync');

      // Create new project
      await page.getByRole('button', { name: 'Create new Project' }).click();
      await page.locator('text=Create').nth(1).click();

      // Check empty project
      await expect(page.locator('.app')).toContainText('This is an empty project, to get started create your first resource:');

      // Rename Project
      await page.getByRole('row', { name: 'My Project' }).getByRole('button', { name: 'Project Actions' }).click();
      await page.getByRole('menuitemradio', { name: 'Settings' }).click();
      await page.getByPlaceholder('My Project').click();
      await page.getByPlaceholder('My Project').fill('My Project123');

      // Check that the project name is updated on modal
      await expect(page.locator('.app')).toContainText('My Project123');

      // Close project settings modal
      await page.locator('.app').press('Escape');
      await expect(page.locator('.app')).toContainText('My Project123');

      // Delete project
      await page.getByRole('row', { name: 'My Project' }).getByRole('button', { name: 'Project Actions' }).click();
      await page.getByRole('menuitemradio', { name: 'Settings' }).click();
      // Click text=NameActions Delete >> button
      await page.click('text=NameActions Delete >> button');
      await page.getByRole('button', { name: 'Click to confirm' }).click();

      // After deleting project, return to default Insomnium Dashboard
      await expect(page.locator('.app')).toContainText('Insomnium');
      await expect(page.locator('.app')).not.toContainText('My Project123');
      await expect(page.locator('.app')).toContainText('My Collection');
      await expect(page.locator('.app')).not.toContainText('Setup Git Sync');
    });
  });
  test.describe('Interactions', async () => { // Not sure about the name here
    // TODO(INS-2504) - we don't support importing multiple collections at this time
    test('Can filter through multiple collections @ci', async ({ app, page }) => {
      await page.getByTestId('project').click();
      await page.getByRole('button', { name: 'Create in project' }).click();
      const text = await loadFixture('multiple-workspaces.yaml');
      await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
      await page.getByRole('menuitemradio', { name: 'Import' }).click();
      await page.getByText('Clipboard').click();
      await page.getByRole('button', { name: 'Scan' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

      // 10 new workspaces besides My Collection
      const workspaceCards = page.getByLabel('Workspaces').getByRole('gridcell');
      await expect(workspaceCards).toHaveCount(11);
      await expect(page.locator('.app')).toContainText('collection 1');
      await expect(page.locator('.app')).toContainText('design doc 1');
      await expect(page.locator('.app')).toContainText('Swagger Petstore V3 JSON 1.0.0');
      await expect(page.locator('.app')).toContainText('Swagger Petstore V3 YAML 1.0.0');

      const filter = page.getByLabel('Workspaces').locator('..').getByPlaceholder('Filter');
      await filter.fill('design');
      await expect(workspaceCards).toHaveCount(4);
      // collection 3, design doc 3 and the two Petstore V3s
      await filter.fill('3');
      await expect(workspaceCards).toHaveCount(4);
      await filter.fill('invalid');
      await expect(page.locator('.app')).toContainText('No documents found for invalid');
    });

    test('Can create, rename and delete a document @ci', async ({ page }) => {
      await page.getByTestId('project').click();
      await expect(page.locator('.app')).not.toContainText('Git Sync');
      await expect(page.locator('.app')).not.toContainText('Setup Git Sync');

      // Create new document
      await page.getByRole('button', { name: 'Create in project' }).click();
      await page.getByRole('menuitemradio', { name: 'Design Document' }).click();
      await page.locator('text=Create').nth(1).click();

      await page.getByTestId('project').click();

      // Rename document
      await page.getByLabel('my-spec.yaml').getByRole('button').click();
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await page.locator('text=Rename DocumentName Rename >> input[type="text"]').fill('test123');
      await page.click('#root button:has-text("Rename")');
      await expect(page.locator('.app')).toContainText('test123');

      // Duplicate document
      await page.click('text=Documenttest123just now >> button');
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      await page.locator('input[name="name"]').fill('test123-duplicate');
      await page.click('[role="dialog"] button:has-text("Duplicate")');

      await page.getByTestId('project').click();

      const workspaceCards = page.getByLabel('Workspaces').getByRole('gridcell');
      // and My Collection, which every project starts with
      await expect(workspaceCards).toHaveCount(3);

      // Delete document
      await page.click('text=Documenttest123just now >> button');
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.locator('text=Yes').click();
      await expect(workspaceCards).toHaveCount(2);
    });

    test('Can create, rename and delete a collection @ci', async ({ page }) => {
      await page.getByTestId('project').click();
      await expect(page.locator('.app')).not.toContainText('Git Sync');
      await expect(page.locator('.app')).not.toContainText('Setup Git Sync');

      // Create new collection
      await page.getByRole('button', { name: 'Create in project' }).click();
      await page.getByRole('menuitemradio', { name: 'Request Collection' }).click();
      await page.locator('text=Create').nth(1).click();

      await page.getByTestId('project').click();

      // Rename collection
      await page.click('text=CollectionMy Collectionjust now >> button');
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await page.locator('text=Rename CollectionName Rename >> input[type="text"]').fill('test123');
      await page.click('#root button:has-text("Rename")');
      await expect(page.locator('.app')).toContainText('test123');

      // Duplicate collection
      await page.click('text=Collectiontest123just now >> button');
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      await page.locator('input[name="name"]').fill('test123-duplicate');
      await page.click('[role="dialog"] button:has-text("Duplicate")');

      await page.getByTestId('project').click();
      const workspaceCards = page.getByLabel('Workspaces').getByRole('gridcell');
      // and My Collection, which every project starts with
      await expect(workspaceCards).toHaveCount(3);

      // Delete collection
      await page.click('text=Collectiontest123just now >> button');
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.locator('text=Yes').click();
      await expect(workspaceCards).toHaveCount(2);
    });
  });
});
