# Translating Insomnium

Insomnium's window and menus come in English, Deutsch, Español, Français, 日本語, Português (Brasil) and 简体中文. **Preferences → General → Language** picks one; out of the box it follows your system's language, or English when Insomnium doesn't have yours (Traditional Chinese included, for now). Changing it reloads the windows. The `INSOMNIUM_LANGUAGE` environment variable (`de`, `ja`…) stands in for the system's language; the end-to-end tests set it to `en`.

The translations other than English were drafted by machine. They're a start, and a speaker's review is the most useful help: open a pull request with fixes to a language's file.

## How it works

English is the source. A string's English text is its key, so a string without a translation shows in English, and the code reads as the window does:

```tsx
import { t } from '../../common/i18n';

<button>{t('Commit')}</button>
```

Each language has a catalog in `packages/insomnia/src/locales/<code>.json`, mapping the English text to the translation:

```json
{
  "Commit": "Commit",
  "Pull with Rebase": "Pull mit Rebase"
}
```

Not every string is translatable yet. The app's main screens, menus, Preferences and Git Sync are; some dialogs and messages still show in English.

## Translating

1. List what a language hasn't got yet, as JSON to fill in:

   ```sh
   npm run i18n:strings -w packages/insomnia -- de
   ```

2. Add the entries to `src/locales/de.json`, or fix the ones there.
3. Check the catalog: `npx jest src/common/__tests__/i18n.test.ts` (in `packages/insomnia`). It fails on an entry the code no longer has, on a translation that drops a placeholder, or on a menu label that loses its `&`.

Keep these as they are:

- **Placeholders**, in braces, which the app fills in: `Saved sign-in for {host}`. They can move within the sentence.
- **Plurals**, which pick a form by the number: `{count, plural, one {# change} other {# changes}}`. Translate the text of each form and keep `#` (the number). Use your language's forms: `one` and `other` for most European languages, only `other` for Japanese and Chinese. An `=0 {…}` form is for zero exactly.
- **Menu mnemonics**: a `&` marks the letter that opens a menu item with Alt on Windows and Linux (`&File`, `Cu&t`). Put one `&` in the translation, before a good letter, or after the word as `(&F)`, as Japanese and Chinese do. Each item of a menu needs a letter of its own: the catalog test lists any two that share one.
- **Names**: Insomnium, Git, GitHub, OAuth, JSON, gRPC, HTTP methods, header names, paths, code and URLs.

## Adding a string

Wrap it in `t()` where it's shown, with its English text as one literal (that's how `npm run i18n:strings` finds it):

```tsx
t('Delete {name}?', { name: request.name })
t('{count, plural, one {# request} other {# requests}}', { count })
```

- Write the whole sentence as one string, with placeholders for what changes. A sentence built from pieces can't be translated.
- A sentence with a link or other element in it is one string too: `tx('See the {link}.', { link: <Link href={…}>{t('documentation')}</Link> })` (from `ui/tx.tsx`) puts the element where the translation has `{link}`.
- A table made when a module loads, before the language is known, marks its strings with `translateLater('…')`, and the code shows them with `t(value)`.
- Menu labels in `main/window-utils.ts` use `label('&File')`.
- Leave out what isn't shown: values that are compared or saved, test ids, log messages.

## Adding a language

Add `src/locales/<code>.json`, import it in `src/common/i18n.ts`, and add it to `LANGUAGES` there, with its name in the language itself.
