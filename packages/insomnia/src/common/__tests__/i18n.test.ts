import fs from 'fs';
import path from 'path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { sourceStrings } from '../../../scripts/i18n-strings';
import { LANGUAGES, menuLabel, resolveLanguage, setLanguage, t } from '../i18n';

const LOCALES = path.join(__dirname, '..', '..', 'locales');

describe('t', () => {
  afterEach(() => setLanguage('en'));

  it('shows English when the language has no translation', () => {
    setLanguage('de');
    expect(t('A string no catalog has')).toBe('A string no catalog has');
  });

  it('puts in values, and picks plural forms by the language', () => {
    const text = 'Stash {count, plural, one {# change} other {# changes}} on {branch}';
    expect(t(text, { count: 1, branch: 'main' })).toBe('Stash 1 change on main');
    expect(t(text, { count: 2, branch: 'main' })).toBe('Stash 2 changes on main');
    expect(t('{count, plural, =0 {nothing} one {one} other {#}}', { count: 0 })).toBe('nothing');
    // French counts 0 as one; Japanese has one form
    setLanguage('fr');
    expect(t('{count, plural, one {# fichier} other {# fichiers}}', { count: 0 })).toBe('0 fichier');
    setLanguage('ja');
    expect(t('{count, plural, other {#件}}', { count: 1200 })).toBe('1,200件');
  });

  it('takes the OS language when none is set, near enough', () => {
    expect(resolveLanguage('de-AT')).toBe('de');
    expect(resolveLanguage('pt')).toBe('pt-BR');
    expect(resolveLanguage('zh_CN')).toBe('zh-CN');
    expect(resolveLanguage('ko-KR')).toBe('en');
    // Traditional Chinese isn't zh-CN's Simplified
    expect(resolveLanguage('zh-TW')).toBe('en');
    expect(resolveLanguage('zh-Hant-HK')).toBe('en');
    expect(resolveLanguage('zh-Hans')).toBe('zh-CN');
    expect(setLanguage('', 'fr-CA')).toBe('fr');
    expect(setLanguage('es', 'fr-CA')).toBe('es');
  });

  it("keeps a menu label's mnemonic where the OS shows it", () => {
    expect(menuLabel('Cu&t', true)).toBe('Cu&t');
    expect(menuLabel('Cu&t', false)).toBe('Cut');
    expect(menuLabel('A&bout {name}', false, { name: 'Insomnium' })).toBe('About Insomnium');
    // Japanese and Chinese put it after the word, as (&F): on macOS it goes whole
    setLanguage('ja');
    expect(menuLabel('&File', true)).toBe('ファイル(&F)');
    expect(menuLabel('&File', false)).toBe('ファイル');
  });
});

// the menus (main/window-utils.ts), each with its items: a letter opens one item of a menu
const MENUS: Record<string, string[]> = {
  bar: ['&Application', '&File', '&Edit', '&View', '&Window', '&Tools', '&Help', '&Developer'],
  application: ['&Preferences', '&Changelog', '&Quit'],
  file: ['&New Window'],
  edit: ['&Undo', '&Redo', 'Cu&t', '&Copy', '&Paste', 'Select &All'],
  view: [
    'Toggle &Full Screen', '&Actual Size', 'Zoom &In', 'Zoom &Out', 'Specific Zoom Level',
    'Resize to &Small (qHD 540)', 'Resize to Defaul&t (HD 720)', 'Resize to &Large (FHD 1080)', 'Toggle Sidebar', 'Toggle &DevTools',
  ],
  window: ['&New', '&Minimize', '&Close'],
  tools: ['&Reload Plugins'],
  help: ['&Help and Support', '&Keyboard Shortcuts', 'Check for &Updates…', 'Show App &Data Folder', 'Show App &Logs Folder', 'Show Open Source Licenses', 'Show Software License', '&About'],
  developer: ['&Reload', 'Take &Screenshot', '&Clear a model', 'Clear &all models', 'R&estart', 'Set window for &FHD Screenshot'],
};
// on macOS only, which shows no mnemonics
const MAC_ONLY = ['A&bout {name}'];

describe('the menus', () => {
  const mnemonic = (label: string) => /&([^&])/.exec(label)?.[1].toLowerCase();

  it('are all here', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'window-utils.ts'), 'utf8');
    const labels = [...source.matchAll(/\blabel\('((?:\\.|[^'\\])*)'/g)].map(([, label]) => label.replace(/\\(.)/g, '$1'));
    const listed = new Set([...Object.values(MENUS).flat(), ...MAC_ONLY]);
    expect(labels.length).toBeGreaterThan(30);
    expect(labels.filter(label => !listed.has(label))).toEqual([]);
  });

  for (const { code } of LANGUAGES) {
    it(`${code}: one letter for each item of a menu`, () => {
      const catalog: Record<string, string> = code === 'en' ? {} : JSON.parse(fs.readFileSync(path.join(LOCALES, `${code}.json`), 'utf8'));
      const clashes = Object.entries(MENUS).flatMap(([menu, labels]) => {
        const letters = labels.map(label => mnemonic(catalog[label] || label)).filter(Boolean);
        return letters.filter((letter, index) => letters.indexOf(letter) !== index).map(letter => `${menu}: ${letter}`);
      });
      expect(clashes).toEqual([]);
    });
  }
});

describe('the catalogs', () => {
  const strings = new Set(sourceStrings());
  // {name} and {name, plural, …}: not a plural form's own text, such as =0 {nothing}
  const placeholders = (text: string) => [...text.matchAll(/(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)(?:\}|, plural)/g)].map(match => match[1]).sort();

  it('finds the strings the code has', () => {
    expect(strings.has('Language')).toBe(true);
    expect(strings.has('Cu&t')).toBe(true);
    expect(strings.has("The system's ({language})")).toBe(true);
  });

  for (const { code } of LANGUAGES.filter(({ code }) => code !== 'en')) {
    it(`${code}: translates only strings the code has, keeping their values and mnemonics`, () => {
      const catalog: Record<string, string> = JSON.parse(fs.readFileSync(path.join(LOCALES, `${code}.json`), 'utf8'));
      const stale = Object.keys(catalog).filter(text => !strings.has(text));
      expect(stale).toEqual([]);
      for (const [text, translated] of Object.entries(catalog)) {
        expect([text, placeholders(translated)]).toEqual([text, placeholders(text)]);
        expect([text, translated.includes('&')]).toEqual([text, text.includes('&')]);
      }
    });
  }
});
