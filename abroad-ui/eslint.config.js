import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import perfectionist from 'eslint-plugin-perfectionist'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  { ignores: ['dist'] },

  {
    files: ['**/src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      stylistic.configs.recommended,
      perfectionist.configs['recommended-natural'],
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
      },
    },
    settings: {
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx'] },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-hooks/exhaustive-deps': 'error',

      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './src/shared', from: './src', except: ['./assets'] },
            { target: './src/features/**/components/**/*', from: './src', except: ['./shared', './assets'] },
          ],
        },
      ],
      '@stylistic/array-element-newline': ['error', { minItems: 3 }],
      '@stylistic/array-bracket-newline': ['error', { minItems: 3 }],
      'import/no-cycle': ['warn', { maxDepth: 1 }],

      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
)
