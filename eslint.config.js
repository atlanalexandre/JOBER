import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `public/leaflet.js` est une bibliothèque tierce minifiée, hébergée localement
  // pour ne plus dépendre d'un CDN. On ne la modifie pas, donc on ne l'analyse pas.
  globalIgnores(['dist', 'public/leaflet.js', 'public/leaflet.css']),
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
      // Bloquant, et non plus simple avertissement : une variable inexistante
      // fait planter l'écran en production (« Can't find variable: … »). Trois
      // cas dormaient dans ces fichiers sans que la CI ne bronche.
      'no-undef': 'error',
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
