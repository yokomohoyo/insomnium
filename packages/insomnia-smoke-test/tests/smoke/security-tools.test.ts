import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { test } from '../../playwright/test';

// a folder of requests only some of the API's users should be able to make
const admin = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Shop, scope: collection }
  - { _id: fld_1, _type: request_group, parentId: wrk_1, name: Admin }
  - { _id: req_1, _type: request, parentId: fld_1, name: Report, method: GET, url: 'http://127.0.0.1:4010/pets/1' }
`;

const pets = `_type: export
__export_format: 4
resources:
  - { _id: wrk_1, _type: workspace, parentId: null, name: Pets, scope: collection }
  - { _id: req_1, _type: request, parentId: wrk_1, name: One pet, method: GET, url: 'http://127.0.0.1:4010/pets/1', parameters: [{ name: kind, value: cat }] }
`;

const filesUnder = (directory: string): string[] => readdirSync(directory)
  .filter(name => name !== '.git')
  .map(name => join(directory, name))
  .flatMap(path => statSync(path).isDirectory() ? filesUnder(path) : [path]);

test('the security mark and an ignored rule say what they do, and go into the repository @ci', async ({ app, page }) => {
  test.setTimeout(120 * 1000);
  const dialog = page.getByRole('dialog');
  // a collection in a repository a team shares (the smoke server's example.git)
  await page.getByTestId('project').click();
  await page.getByRole('button', { name: 'Create in project' }).click();
  await page.getByRole('menuitemradio', { name: 'Git Clone' }).click();
  await dialog.getByLabel('Git URI').fill('http://127.0.0.1:4010/git/example.git');
  await dialog.getByLabel('Author Name').fill('Kim');
  await dialog.getByLabel('Author Email').fill('kim@example.com');
  await dialog.getByLabel('Username').fill('smoke');
  await dialog.getByLabel('Authentication Token').fill('token');
  await dialog.getByRole('button', { name: 'Clone' }).click();
  await expect(page.getByRole('button', { name: 'example.git' })).toBeVisible();

  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), admin);
  await page.getByRole('button', { name: 'example.git' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await dialog.getByRole('button', { name: 'Import' }).click();
  // a cloned repository opens as a design document, on its spec
  await page.getByRole('link', { name: 'Requests' }).click();

  // the folder is marked, and so is what's in it: a note about the API, shown
  // with a person and shield
  const requests = page.getByLabel('Request Collection');
  const folder = requests.getByRole('row', { name: 'Admin' });
  await folder.getByLabel('Request Group Actions').click();
  await page.getByRole('menuitemradio', { name: 'Only Some API Users May Call It' }).click();
  await expect(requests.getByLabel('Only some API users may call it')).toHaveCount(2);
  // the same item takes the mark off
  await folder.getByLabel('Request Group Actions').click();
  await expect(page.getByRole('menuitemradio', { name: 'Every API User May Call It' })).toBeVisible();
  await page.keyboard.press('Escape');

  // the request's Security tab says so, and what it needs to be tried
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');
  await requests.getByRole('row', { name: 'Report' }).click();
  await expect(requestPane.getByTestId('OneLineEditor').first()).toContainText('127.0.0.1:4010/pets/1');
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane.getByTestId('response-status-tag')).toContainText('200');
  await responsePane.getByRole('tab', { name: /Security/ }).click();
  await expect(responsePane.getByTestId('security-restricted-note')).toContainText('This request is marked as only for some API users');

  // a rule the collection ignores
  const ignore = responsePane.getByRole('button', { name: /^Ignore / }).first();
  await ignore.click();
  await expect(responsePane.getByText('Not shown in this collection:')).toBeVisible();

  // Security Checks over the folder says how many are marked before it starts
  await folder.getByLabel('Request Group Actions').click();
  await page.getByRole('menuitemradio', { name: 'Security Checks' }).click();
  await expect(dialog.getByTestId('security-run-marked')).toContainText('1 request is marked as only for some API users');
  await page.screenshot({ path: 'traces/security-checks-marked.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // on a branch of its own (the server lives on between runs), committed and pushed
  const branch = `mark-${Date.now()}`;
  const gitMenu = page.getByTestId('git-dropdown').locator('button');
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Branches' }).click();
  await dialog.getByPlaceholder('testing-branch').fill(branch);
  await dialog.getByRole('button', { name: '+ Create' }).click();
  await expect(page.getByTestId('git-dropdown')).toContainText(branch);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Commit' }).click();
  await dialog.getByPlaceholder('A descriptive message to describe changes made').fill('mark the admin folder');
  await dialog.locator('input[name="allUnversioned"]').check();
  await dialog.getByRole('button', { name: 'Commit' }).click();
  await expect(dialog).toContainText('Committed.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await gitMenu.click();
  await page.getByRole('menuitem', { name: 'Push' }).click();
  const branches = () => execFileSync('git', ['ls-remote', '--heads', 'http://127.0.0.1:4010/git/example.git']).toString();
  await expect.poll(branches).toContain(`refs/heads/${branch}`);

  // what a teammate who pulls gets: the mark on the folder, the rule on the collection
  const clone = mkdtempSync(join(tmpdir(), 'smoke-mark-'));
  execFileSync('git', ['clone', '--quiet', '--branch', branch, 'http://127.0.0.1:4010/git/example.git', clone]);
  const files = filesUnder(clone).map(path => readFileSync(path, 'utf8'));
  const group = files.find(text => text.includes('name: Admin'));
  expect(group).toContain('securityRestricted: true');
  const request = files.find(text => text.includes('name: Report'));
  // the request is covered by its folder's mark, not by one of its own
  expect(request).not.toContain('securityRestricted');
  const workspace = files.find(text => /securityIgnoredRules:\s*\n\s+- \S+/.test(text));
  expect(workspace, 'the ignored rule is in the collection file').toBeTruthy();
});

test('fuzzes a request, compares two of its responses and decodes a value @ci', async ({ app, page }) => {
  test.setTimeout(120 * 1000);
  const dialog = page.getByRole('dialog');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), pets);
  await page.getByRole('button', { name: 'My Collection' }).click();
  await page.getByRole('menuitem', { name: 'Import' }).click();
  await page.getByText('Clipboard').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await dialog.getByRole('button', { name: 'Import' }).click();

  const requests = page.getByLabel('Request Collection');
  const requestPane = page.getByTestId('request-pane');
  const responsePane = page.getByTestId('response-pane');
  const row = requests.getByRole('row', { name: 'One pet' });
  await row.click();
  await expect(requestPane.getByTestId('OneLineEditor').first()).toContainText('127.0.0.1:4010/pets/1');
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane.getByTestId('response-status-tag')).toContainText('200');

  // Fuzz: two payloads of our own in the query parameter, and the request once as it is
  await row.getByLabel('Request Actions').click();
  await page.getByRole('menuitemradio', { name: 'Fuzz' }).click();
  await expect(dialog.getByLabel('Positions').getByText('Query: kind')).toBeVisible();
  for (const list of ['SQL', 'Odd values', 'Fields to slip in']) {
    await dialog.getByLabel('Payload lists').getByText(list, { exact: true }).click();
  }
  await dialog.getByLabel(/Your own, one a line/).fill('dog\n0');
  await expect(dialog.getByTestId('fuzz-plan')).toContainText('4 attempts, and the request once as it is.');
  await page.screenshot({ path: 'traces/fuzz-setup.png' });
  await dialog.getByRole('button', { name: 'Send 5 Requests' }).click();
  await expect(dialog.getByTestId('fuzz-summary')).toContainText('5 requests sent');
  await dialog.getByLabel('Only those worth a look').uncheck();
  await expect(dialog.getByTestId('fuzz-attempt-1')).toContainText('dog');
  await expect(dialog.getByTestId('fuzz-attempt-2')).toContainText('200');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Compare Responses: a second response to set against the first
  await requestPane.getByRole('button', { name: 'Send' }).click();
  await expect(responsePane.getByTestId('response-status-tag')).toContainText('200');
  await responsePane.getByTitle('Response history').click();
  await page.getByRole('menuitem', { name: 'Compare Responses' }).click();
  await expect(dialog).toContainText('Compare Responses');
  await expect(dialog.getByLabel('First')).toBeVisible();
  // the same request sent twice: the same status and body
  await expect(dialog.getByTestId('compare-count-Status')).toContainText('the same');
  await expect(dialog.getByTestId('compare-count-Body')).toContainText('the same');
  await page.screenshot({ path: 'traces/compare-responses.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Decoder: Base64 out, and back in again
  await page.getByTestId('decoder-button').click();
  await dialog.getByLabel('Value').fill('aGVsbG8gd29ybGQ=');
  await dialog.getByRole('group', { name: 'Decode' }).getByRole('button', { name: 'Base64', exact: true }).click();
  await expect(dialog.getByLabel(/^Result/)).toHaveValue('hello world');
  await expect(dialog.getByTestId('decoder-done')).toContainText('Decode: Base64');
  await dialog.getByRole('button', { name: 'Use as the Value' }).click();
  await dialog.getByRole('group', { name: 'Hash' }).getByRole('button', { name: 'SHA-1' }).click();
  await expect(dialog.getByLabel(/^Result/)).toHaveValue('2aae6c35c94fcfb415dbe95f408b9ce91ee846ed');
});
