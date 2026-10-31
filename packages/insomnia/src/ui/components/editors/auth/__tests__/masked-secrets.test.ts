import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// every auth field that holds a secret is masked, as passwords are, unless
// Preferences shows them
const AUTH_DIR = path.join(__dirname, '..');
const SECRET = /secret|password|^token$|auth key|assertion|subject token|actor token|session token|^value$/i;

const rows = fs.readdirSync(AUTH_DIR)
  .filter(file => file.endsWith('.tsx'))
  .flatMap(file => [...fs.readFileSync(path.join(AUTH_DIR, file), 'utf8').matchAll(/<AuthInputRow\b[^>]*?\/>/gs)]
    .map(([row]) => ({ file, row, label: /label=['"]([^'"]+)['"]/.exec(row)?.[1] || '' })));

describe('auth fields', () => {
  it('are found', () => {
    expect(rows.length).toBeGreaterThan(30);
  });

  it('mask every secret', () => {
    const unmasked = rows.filter(({ label, row }) => SECRET.test(label) && !/\bmask\b/.test(row)).map(({ file, label }) => `${file}: ${label}`);
    expect(unmasked).toEqual([]);
  });
});
