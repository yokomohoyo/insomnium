import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { bundleType, cwd, executablePath, mainPath, randomDataPath } from '../../playwright/paths';

test('backs up the data on the first launch of a new version', async ({ playwright }) => {
  // Data left behind by an older version
  const dataPath = randomDataPath();
  fs.cpSync(path.join(__dirname, '..', '..', 'fixtures', 'inso-nedb'), dataPath, { recursive: true });
  fs.writeFileSync(path.join(dataPath, 'last-run-version'), '0.0.1');

  const app = await playwright._electron.launch({
    cwd,
    executablePath,
    args: bundleType() === 'package' ? [] : [mainPath],
    env: {
      ...process.env,
      INSOMNIA_DATA_PATH: dataPath,
      PLAYWRIGHT: 'true',
    },
  });
  // The backup is made before the database opens, so before the window exists
  await (await app.firstWindow()).waitForLoadState();
  await app.close();

  expect(fs.readdirSync(path.join(dataPath, 'backups', '0.0.1'))).toContain('insomnia.Project.db');
  expect(fs.readFileSync(path.join(dataPath, 'last-run-version'), 'utf8')).not.toBe('0.0.1');
});
