// The app's translatable strings, as the code has them: the English text of
// each t('…'), tx('…') and translateLater('…'), and of the menu's label('…')
// in main/window-utils.ts.
//
//   npm run i18n:strings              every string, as a JSON list
//   npm run i18n:strings -- de        the ones locales/de.json hasn't got, as JSON to fill in
//
// See docs/translating.md. common/__tests__/i18n.test.ts checks the catalogs with it.
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', 'src');

// t('…') or t("…"): one literal, in which its own quote may be escaped
const CALL = /(?<![\w.$])(t|tx|translateLater|label)\(\s*(['"])((?:\\.|(?!\2)[^\\\n])*)\2/g;

const unescape = (text: string) => text.replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char));

export function sourceStrings(root = SRC) {
  const strings = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['__tests__', '__mocks__', '__jest__', 'node_modules'].includes(entry.name)) {
          walk(file);
        }
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) {
        const menu = file.endsWith(path.join('main', 'window-utils.ts'));
        for (const [, fn, , body] of fs.readFileSync(file, 'utf8').matchAll(CALL)) {
          if (fn !== 'label' || menu) {
            strings.add(unescape(body));
          }
        }
      }
    }
  };
  walk(root);
  return [...strings].sort();
}

if (require.main === module) {
  const strings = sourceStrings();
  const language = process.argv[2];
  if (!language) {
    console.log(JSON.stringify(strings, null, 2));
  } else {
    const catalog: Record<string, string> = JSON.parse(fs.readFileSync(path.join(SRC, 'locales', `${language}.json`), 'utf8'));
    console.log(JSON.stringify(Object.fromEntries(strings.filter(text => !catalog[text]).map(text => [text, ''])), null, 2));
  }
}
