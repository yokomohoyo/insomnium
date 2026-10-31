import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// every .tsx under ui, with its path relative to ui
const sources = (dir: string): [string, string][] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    return entry.name === '__tests__' ? [] : sources(full);
  }
  return entry.name.endsWith('.tsx') ? [[path.relative(path.join(__dirname, '..'), full), fs.readFileSync(full, 'utf8')]] : [];
});
const files = sources(path.join(__dirname, '..'));

describe('icon-only buttons', () => {
  it('name every dropdown trigger that only holds icons', () => {
    const unnamed = files.flatMap(([file, source]) =>
      [...source.matchAll(/<DropdownButton\b([^>]*)>\s*(?:<i\b[^>]*\/>\s*)+<\/DropdownButton>/g)]
        .filter(([, attributes]) => !/aria-label/.test(attributes))
        .map(([match]) => `${file}: ${match.replace(/\s+/g, ' ')}`));
    expect(unnamed).toEqual([]);
  });

  it('keep empty spacers out of the tab order', () => {
    const spacers = files.flatMap(([file, source]) =>
      [...source.matchAll(/<button>\s*<i className="fa fa-empty" \/>\s*<\/button>/g)].map(() => file));
    expect(spacers).toEqual([]);
  });
});
