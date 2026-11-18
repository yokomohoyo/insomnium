import type { PlaywrightTestConfig } from '@playwright/test';

import base from './playwright.config';

// The README's screenshots: `npm run screenshots` takes them again, into
// /screenshots, from the build `npm run app-build` made. Not part of the test run.
const config: PlaywrightTestConfig = {
  ...base,
  projects: [{ name: 'Screenshots', testMatch: /screenshots\/.*\.shots\.ts/, retries: 0 }],
  timeout: 90 * 1000,
  reporter: 'list',
};
export default config;
