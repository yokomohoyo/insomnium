/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

import { defines } from '../../../../esbuild.main';
import pkg from '../../../../package.json';

// app-senders.ts as the main process's bundle has it (esbuild.main.ts)
const built = (mode: 'development' | 'production') => esbuild.transformSync(
  fs.readFileSync(path.join(__dirname, '../app-senders.ts'), 'utf8'),
  { loader: 'ts', define: defines(mode) },
).code;

describe('appPageUrl(), built', () => {
  it("has the dev server's page in a development build", () => {
    expect(built('development')).toContain(`!electron.app.isPackaged && "http://localhost:${pkg.dev['dev-server-port']}/index.html"`);
  });

  it('has no page but its own in a production build', () => {
    expect(built('production')).toContain('!electron.app.isPackaged && ""');
  });

  it('leaves nothing for the environment to say', () => {
    expect(built('development')).not.toContain('APP_RENDER_URL');
    expect(built('production')).not.toContain('APP_RENDER_URL');
  });
});
