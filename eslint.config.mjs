import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The one config for every package: eslint finds it from a package's directory
// too, and the patterns below are relative to this file wherever it runs from.
export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    // dot files and folders (.github, .idea, .cache, .husky, ...)
    '**/.*',
    'docker/',
    '**/traces/',
    '**/build/',
    '**/dist/',
    '**/coverage/',
    '**/bin/',
    '**/*.min.js',
    'packages/insomnia-testing/**/fixtures/',
    // generated
    '**/svgr/',
    'packages/insomnia/svgr.config.js',
    'packages/insomnia/src/preload.js',
    'packages/insomnia/src/plugin-host-preload.js',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [
      tseslint.configs.recommended,
      react.configs.flat.recommended,
    ],
    plugins: {
      '@stylistic': stylistic,
      'react-hooks': reactHooks,
      import: importPlugin,
      'simple-import-sort': simpleImportSort,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.es2015,
        ...globals.jest,
        ...globals.node,
        __DEV__: true,
        fail: true,
        NodeJS: true,
        JSX: true,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'consistent-return': 'off', // found to be too many false positives
      'curly': 'off', // onliner 'if' is fine
      'default-case': 'error',
      'default-case-last': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-loss-of-precision': 'error',
      'no-var': 'error',
      // eslint's own (deprecated) rule, not @stylistic's: that one also checks
      // type literals, which are written both ways here, and can't be told not to
      'object-curly-spacing': ['error', 'always'],
      'no-restricted-properties': ['error', {
        property: 'openExternal',
        message: 'use the `window.main.openInBrowser` function instead.  see https://security.stackexchange.com/questions/225799/dangers-of-electrons-shell-openexternal-on-untrusted-content for more information.',
      }],

      // formatting
      '@stylistic/array-bracket-spacing': 'error',
      '@stylistic/arrow-spacing': 'error',
      '@stylistic/block-spacing': 'error',
      '@stylistic/brace-style': ['error', '1tbs'],
      // as eslint's own rule did with this parser: nothing asked of function
      // arguments, enums, generics and tuples
      '@stylistic/comma-dangle': ['error', {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'ignore',
        importAttributes: 'ignore',
        dynamicImports: 'ignore',
        enums: 'ignore',
        generics: 'ignore',
        tuples: 'ignore',
      }],
      '@stylistic/comma-spacing': 'error',
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/member-delimiter-style': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 3, maxEOF: 0 }],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/space-before-function-paren': ['error', { anonymous: 'never', named: 'never', asyncArrow: 'always' }],
      '@stylistic/space-in-parens': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/space-unary-ops': 'error',

      'react/display-name': 'warn',
      'react/no-unescaped-entities': 'off',
      'react/jsx-first-prop-new-line': ['error', 'multiline'],
      'react/jsx-max-props-per-line': ['error', { maximum: 1, when: 'multiline' }],
      'react/jsx-indent-props': ['error', 2],
      'react/prop-types': 'off',
      'react/function-component-definition': ['error', {
        namedComponents: 'arrow-function',
        unnamedComponents: 'arrow-function',
      }],
      'react/jsx-closing-bracket-location': ['error', 'line-aligned'],
      'react/prefer-stateless-function': 'error',
      'react/jsx-key': ['error', { checkFragmentShorthand: true }],
      'react/no-array-index-key': 'warn',
      'react/no-find-dom-node': 'off',
      'react/self-closing-comp': 'error',

      'react-hooks/exhaustive-deps': ['warn', {
        // From react-use https://github.com/streamich/react-use/issues/1703#issuecomment-770972824
        additionalHooks: '^use(Async|AsyncFn|AsyncRetry|Debounce|UpdateEffect|IsomorphicLayoutEffect|DeepCompareEffect|ShallowCompareEffect)$',
      }],
      'react-hooks/rules-of-hooks': 'error',

      '@typescript-eslint/array-type': ['error', { default: 'array', readonly: 'array' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-empty-interface': ['error', { allowSingleExtends: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-redeclare': 'error',
      // caughtErrors: typescript-eslint 8 would report an unused `catch (err)`
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // an interface that only extends another is how a declaration is merged or renamed
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],

      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import/no-duplicates': 'error',
    },
  },
  {
    // Playwright's fixtures call a function named `use`, which
    // eslint-plugin-react-hooks 5 takes for React's hook
    files: ['packages/insomnia-smoke-test/playwright/test.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // a test loads a module with require() where the load has to come after a
    // jest.mock or a change of state, and inside a jest.mock factory
    files: ['**/__tests__/**', '**/__perf__/**', '**/__mocks__/**'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Vite builds the renderer with process.env replaced by {}, except the
    // keys in vite.config.ts's define. Excluded: tests and main-process files
    // that aren't in the renderer bundle.
    files: ['packages/insomnia/src/**/*.{ts,tsx}'],
    ignores: [
      '**/__tests__/**',
      'packages/insomnia/src/main.development.ts',
      'packages/insomnia/src/main/backup.ts',
      'packages/insomnia/src/main/credential-keys.ts',
      'packages/insomnia/src/main/install-plugin.ts',
      'packages/insomnia/src/main/ipc/app-senders.ts',
      'packages/insomnia/src/main/mcp/discovery.ts',
      'packages/insomnia/src/main/network/curl.ts',
      'packages/insomnia/src/main/network/websocket.ts',
      'packages/insomnia/src/main/window-utils.ts',
      'packages/insomnia/src/server/**',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...[
        "MemberExpression[object.name='process'][property.name='env'][computed=false]:not(MemberExpression[property.name=/^(NODE_ENV|INSOMNIA_ENV|BUILD_DATE)$/] > MemberExpression.object)",
        "MemberExpression[object.name='process'][property.value='env']",
      ].map(selector => ({
        selector,
        message: "process.env is {} in the renderer build. Use `import { env } from 'node:process'`, or os.homedir() for HOME.",
      }))],
    },
  },
]);
