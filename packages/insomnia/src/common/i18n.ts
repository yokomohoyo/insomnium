// The app's languages. English is the source: a string's English text is its
// key, so one with no translation yet shows in English, and the code reads as
// it shows. Translations are JSON catalogs in src/locales, by language code
// (docs/translating.md). Used in the window and in the main process (menus).
import de from '../locales/de.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import ja from '../locales/ja.json';
import ptBR from '../locales/pt-BR.json';
import zhCN from '../locales/zh-CN.json';

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'ja', name: '日本語' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'zh-CN', name: '简体中文' },
] as const;

export type Language = typeof LANGUAGES[number]['code'];

const catalogs: Record<Exclude<Language, 'en'>, Record<string, string>> = { de, es, fr, ja, 'pt-BR': ptBR, 'zh-CN': zhCN };

let language: Language = 'en';

// a language tag (a setting, the OS's) as one the app has: de-AT is de, pt is pt-BR, zh-Hans is zh-CN; others English
export function resolveLanguage(tag?: string | null): Language {
  const wanted = (tag || '').replace('_', '-').toLowerCase();
  const exact = LANGUAGES.find(({ code }) => code.toLowerCase() === wanted);
  if (exact) {
    return exact.code;
  }
  const base = wanted.split('-')[0];
  return LANGUAGES.find(({ code }) => code.split('-')[0] === base)?.code || 'en';
}

// the setting's language, or the OS's when it has none
export function setLanguage(setting: string | null | undefined, system?: string | null) {
  language = resolveLanguage(setting || system);
  return language;
}

export const currentLanguage = () => language;

const plural = (count: number, forms: Record<string, string>) => {
  const exact = forms[`=${count}`];
  if (exact !== undefined) {
    return exact;
  }
  return forms[new Intl.PluralRules(language).select(count)] ?? forms.other ?? '';
};

// {name, plural, one {# thing} other {# things}}: a block's text up to its closing brace, nested ones included
function pluralBlocks(text: string, values: Record<string, string | number>) {
  let out = '';
  let index = 0;
  const opening = /\{(\w+), plural,/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text))) {
    out += text.slice(index, match.index);
    let depth = 1;
    let end = opening.lastIndex;
    for (; end < text.length && depth; end++) {
      depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0;
    }
    const body = text.slice(opening.lastIndex, end - 1);
    const forms: Record<string, string> = {};
    for (const form of body.matchAll(/\s*(=\d+|zero|one|two|few|many|other)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      forms[form[1]] = form[2];
    }
    const count = Number(values[match[1]]);
    out += plural(count, forms).replace(/#/g, new Intl.NumberFormat(language).format(count));
    index = end;
    opening.lastIndex = end;
  }
  return out + text.slice(index);
}

/**
 * The text in the app's language, with its values: {name} is one, and
 * {count, plural, one {# change} other {# changes}} picks the language's form
 * for the count. t('Pull with Rebase'), t('Stash {count, plural, one {# change} other {# changes}}', { count }).
 */
export function t(text: string, values?: Record<string, string | number>) {
  const translated = language === 'en' ? text : catalogs[language][text] || text;
  if (!values) {
    return translated;
  }
  return pluralBlocks(translated, values).replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}

// a menu label, whose & marks its mnemonic (Cu&t): kept where the OS shows them, dropped on macOS
export const menuLabel = (text: string, mnemonics: boolean, values?: Record<string, string | number>) => {
  const label = t(text, values);
  return mnemonics ? label : label.replace(/&(?!&)/g, '');
};
