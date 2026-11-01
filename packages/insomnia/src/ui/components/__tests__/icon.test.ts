/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { findIconDefinition, type IconName, type IconPrefix } from '@fortawesome/fontawesome-svg-core';
import { fab } from '@fortawesome/free-brands-svg-icons';
import { fas } from '@fortawesome/free-solid-svg-icons';

import '../icon';

const SRC = path.join(__dirname, '..', '..', '..');

const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? (entry.name === '__tests__' ? [] : sources(file)) : /\.tsx?$/.test(entry.name) ? [file] : [];
});

// strings in those files that happen to be icon names, but aren't shown as icons
const NOT_ICONS = new Set([
  // a spec version's prefix, on the projects page
  'v',
]);

// every name or alias in a whole set
const names = (set: typeof fas) => new Set(Object.values(set).flatMap(def => [def.iconName, ...(def.icon[2] as string[]).filter(alias => typeof alias === 'string')]));

describe('<Icon>', () => {
  it('has every icon the files that show it name', () => {
    const users = sources(SRC).filter(file => /import \{ Icon \} from '[./]*(components\/)?icon'/.test(fs.readFileSync(file, 'utf8')));
    expect(users.length).toBeGreaterThan(5);
    const solid = names(fas);
    const brands = names(fab);
    const missing: string[] = [];
    for (const file of users) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, prefix, name] of text.matchAll(/\[\s*'(fas|far|fab)'\s*,\s*'([a-z0-9-]+)'\s*\]/g)) {
        if ((prefix === 'fab' ? brands : solid).has(name) && !findIconDefinition({ prefix: prefix as IconPrefix, iconName: name as IconName })) {
          missing.push(`${path.relative(SRC, file)}: ${prefix} ${name}`);
        }
      }
      for (const [, name] of text.matchAll(/['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/g)) {
        if (solid.has(name) && !NOT_ICONS.has(name) && !findIconDefinition({ prefix: 'fas', iconName: name as IconName })) {
          missing.push(`${path.relative(SRC, file)}: ${name}`);
        }
      }
    }
    // add these to library.add() in icon.tsx
    expect(missing).toEqual([]);
  });
});
