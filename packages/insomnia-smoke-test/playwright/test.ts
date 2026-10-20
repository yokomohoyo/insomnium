// Read more about creating fixtures https://playwright.dev/docs/test-fixtures
import { ElectronApplication, test as baseTest, TraceMode } from '@playwright/test';
import path from 'path';

import {
  bundleType,
  cwd,
  executablePath,
  mainPath,
  randomDataPath,
} from './paths';

interface EnvOptions {
  INSOMNIA_DATA_PATH: string;
  INSOMNIA_API_URL: string;
  INSOMNIUM_LANGUAGE: string;
}

export const test = baseTest.extend<{
  app: ElectronApplication;
}>({
  app: async ({ playwright, trace }, use, testInfo) => {
    const webServerUrl = testInfo.config.webServer?.url;

    const options: EnvOptions = {
      INSOMNIA_DATA_PATH: randomDataPath(),
      INSOMNIA_API_URL: webServerUrl + '/api',
      // English, whatever this computer's language: the tests find things by their English names
      INSOMNIUM_LANGUAGE: 'en',
    };

    const electronApp = await playwright._electron.launch({
      cwd,
      executablePath,
      args: bundleType() === 'package' ? [] : [mainPath],
      env: {
        ...process.env,
        ...options,
        PLAYWRIGHT: 'true',
      },
    });

    const appContext = electronApp.context();
    const traceMode: TraceMode = typeof trace === 'string' ? trace as TraceMode : trace.mode;

    const defaultTraceOptions = { screenshots: true, snapshots: true, sources: true };
    const traceOptions = typeof trace === 'string' ? defaultTraceOptions : { ...defaultTraceOptions, ...trace, mode: undefined };
    const captureTrace = (traceMode === 'on' || traceMode === 'retain-on-failure' || (traceMode === 'on-first-retry' && testInfo.retry === 1));

    if (captureTrace) {
      await appContext.tracing.start(traceOptions);
    }

    await use(electronApp);

    if (captureTrace) {
      await appContext.tracing.stop({
        path: path.join(testInfo.outputDir, 'trace.zip'),
      });
    }

    await electronApp.close();
  },
  page: async ({ app }, use, testInfo) => {
    const page = await app.firstWindow();
    // the window's console, printed when a test fails: what the app said meanwhile
    const logs: string[] = [];
    page.on('console', message => logs.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', error => logs.push(`[pageerror] ${error.message}`));

    await page.waitForLoadState();

    await use(page);

    if (testInfo.status !== testInfo.expectedStatus) {
      console.log(`--- the window's console during "${testInfo.title}" ---\n${logs.slice(-200).join('\n')}`);
    }
  },
});
