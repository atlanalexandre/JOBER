import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/App.jsx', 'src/components/client-screens.jsx', 'src/components/backoffice.jsx', 'src/components/auth.jsx'],
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-refresh/only-export-components': 'warn',
      'no-undef': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  {
    files: ['api/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, fetch: 'readonly', Response: 'readonly', Request: 'readonly', Headers: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', crypto: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      'no-empty': 'warn',
      'no-unused-vars': ['warn', { caughtErrors: 'none', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
])
