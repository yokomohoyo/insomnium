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
    expect(setLanguage('', 'fr-CA')).toBe('fr');
    expect(setLanguage('es', 'fr-CA')).toBe('es');
  });

  it("keeps a menu label's mnemonic where the OS shows it", () => {
    expect(menuLabel('Cu&t', true)).toBe('Cu&t');
    expect(menuLabel('Cu&t', false)).toBe('Cut');
    expect(menuLabel('A&bout {name}', false, { name: 'Insomnium' })).toBe('About Insomnium');
  });
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
