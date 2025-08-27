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
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      stylistic.configs.recommended,             // registers @stylistic
      perfectionist.configs['recommended-natural'], // registers perfectionist
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    'settings': {
      'import/resolver': {
        'node': {
          'extensions': [
            '.ts',
            '.tsx'
          ]
        }
      }
    },
    // Don't re-declare plugins that presets already add
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'react-hooks/exhaustive-deps': 'error',
      'import/no-restricted-paths': [
        'warn',
        {
          zones: [
            { target: './src/components', from: './src/pages' },
            { target: './src/components', from: './src/components' },
          ],
        },
      ],
      '@stylistic/array-element-newline': ['error', { minItems: 3 }],
      '@stylistic/array-bracket-newline': ['error', { minItems: 3 }],
      'import/no-cycle': ['warn', { maxDepth: 1 }],
    },
  },
)
