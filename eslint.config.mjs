import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

// The Next.js app is gone; the only first-party JS left is the two hand-written,
// no-build browser scripts served by WhiteNoise (the OBS overlay widget + the
// htmx/Alpine page glue). Lint just those — plus this config — as plain browser JS.
const config = [
  js.configs.recommended,
  prettier,
  {
    files: ['djclass_overlay/**/*.js'],
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
    ignores: [
      'node_modules/',
      '.next/', // stale legacy Next.js build output (gitignored; absent in CI)
      '.venv/', // Python virtualenv — don't lint third-party deps' bundled JS (Django admin)
      'staticfiles/', // collectstatic output (copies of the above)
      'data/',
    ],
  },
]

export default config
