import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

// The only first-party JS is the two hand-written, no-build browser scripts
// embedded in the Go binary (the OBS overlay widget + the Alpine page glue).
// Lint just those — plus this config and the smoke test — as plain JS.
const config = [
  js.configs.recommended,
  prettier,
  {
    files: ['internal/web/static/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      // Alpine is declared per-file via `/* global Alpine */` (only components.js
      // needs it; the overlay widget doesn't); htmx is accessed off `window`.
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node-run smoke tests for the browser scripts (CommonJS, runs under `node`).
    files: ['tests/**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['node_modules/', 'data/'],
  },
]

export default config
